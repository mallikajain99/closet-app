import sharp from "sharp";

/**
 * Background removal via Replicate.
 *
 * Deliberately not marked `server-only`: that package throws outside a Next runtime, and
 * this module is also driven by scripts/process-images.ts under plain Node. It reads
 * REPLICATE_API_TOKEN, which is server-side by construction — never a NEXT_PUBLIC_ var —
 * so it cannot reach the browser bundle regardless.
 *
 * `851-labs/background-remover` is a BiRefNet-derived salient-object segmenter. Because
 * the catalog photos are garments on hangers rather than on a person, this is the whole
 * segmentation step — the person-parsing pass described in the plan isn't needed, which
 * removes the least predictable part of the pipeline.
 */
const MODEL = "851-labs/background-remover";

/**
 * Prompt-guided segmentation, used only to find *where the clothing is*.
 *
 * Its mask is too coarse to cut with directly — sleeve-to-body gaps fill in and edges
 * soften. But as a gate over the crisp cutout it's ideal: it excludes the hanger, which
 * salient-object segmentation otherwise keeps as part of the subject.
 */
const MASK_MODEL = "schananas/grounded_sam";
const MASK_PROMPT = "shirt,clothing,garment,jacket,sweater";
const MASK_NEGATIVE_PROMPT = "hanger,hook,wire,door,wall";

/**
 * Predictions are created asynchronously and polled.
 *
 * Replicate's `Prefer: wait` header holds the connection open until the prediction
 * finishes, which is convenient — but when the request is *rejected* (402 out of credit,
 * 429 throttled) the held connection drops and Node surfaces a bare "fetch failed",
 * hiding the actual status and its explanation. Polling costs a few extra requests and
 * always reports the real error.
 */
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 180_000;

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

function token() {
  const value = process.env.REPLICATE_API_TOKEN;
  if (!value) {
    throw new Error(
      "REPLICATE_API_TOKEN is not set. Create one at replicate.com/account/api-tokens.",
    );
  }
  return value;
}

/**
 * How much to grow the clothing mask before using it as a gate.
 *
 * The gate must sit slightly *outside* the garment so it never clips the crisp cutout's
 * own edge — the point is to remove the hanger, not to re-cut the shirt. Blur spreads the
 * mask outward; the linear ramp then hardens it back to near-binary so the interior stays
 * fully opaque rather than fading.
 */
const GATE_BLUR = 12;
const GATE_GAIN = 6;
const GATE_OFFSET = -300;

type Prediction = {
  id: string;
  status: "starting" | "processing" | "succeeded" | "failed" | "canceled";
  output?: string | string[] | null;
  error?: string | null;
  urls?: { get?: string };
};

/**
 * Resolve and cache the model's current version id.
 *
 * The convenient `/v1/models/{owner}/{name}/predictions` endpoint is only available for
 * Replicate's *official* models; community models 404 there and must be run against a
 * pinned version through `/v1/predictions`.
 */
const versionCache = new Map<string, string>();

async function latestVersionOf(model: string): Promise<string> {
  const cached = versionCache.get(model);
  if (cached) return cached;

  const response = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!response.ok) {
    throw new Error(`Could not resolve ${model} (${response.status}).`);
  }

  const payload = (await response.json()) as { latest_version?: { id?: string } };
  if (!payload.latest_version?.id) throw new Error(`${model} has no published version.`);

  versionCache.set(model, payload.latest_version.id);
  return payload.latest_version.id;
}

/**
 * Create a prediction, waiting out rate limiting.
 *
 * Accounts without a payment method are capped at a few predictions per minute, and
 * Replicate says exactly how long to wait — so honour `retry_after` rather than failing
 * the item and forcing a re-run.
 */
async function postPrediction(
  version: string,
  input: Record<string, unknown>,
  attempts = 4,
) {
  let response!: Response;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({ version, input }),
    });

    if (response.status !== 429 || attempt === attempts) return response;

    const body = (await response.clone().json().catch(() => ({}))) as { retry_after?: number };
    const waitMs = Math.max(1, body.retry_after ?? 10) * 1000 + 500;
    console.log(`    rate limited — waiting ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }

  return response;
}

/** Poll a created prediction until it finishes, or throw with the reason it didn't. */
async function awaitPrediction(prediction: Prediction): Promise<Prediction> {
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  let current = prediction;

  while (current.status === "starting" || current.status === "processing") {
    if (Date.now() > deadline) throw new Error("Prediction timed out.");
    await sleep(POLL_INTERVAL_MS);

    const pollUrl =
      current.urls?.get ?? `https://api.replicate.com/v1/predictions/${current.id}`;
    const polled = await fetch(pollUrl, { headers: { Authorization: `Bearer ${token()}` } });
    if (!polled.ok) throw new Error(`Polling failed (${polled.status}).`);
    current = (await polled.json()) as Prediction;
  }

  if (current.status !== "succeeded") {
    throw new Error(`Prediction ${current.status}: ${current.error ?? "no detail"}`);
  }

  return current;
}

function firstOutputUrl(prediction: Prediction): string {
  const { output } = prediction;
  const url = Array.isArray(output) ? output[0] : output;
  if (typeof url !== "string" || !url) {
    throw new Error("Segmentation returned no image.");
  }
  return url;
}

/**
 * Remove the background from an image, returning a PNG with an alpha channel.
 *
 * The source is sent as a data URI rather than a storage URL: the buckets are private,
 * so a URL would mean minting a signed one and hoping it outlives the prediction.
 */
export async function removeBackground(source: Buffer): Promise<Buffer> {
  const dataUri = `data:image/jpeg;base64,${source.toString("base64")}`;
  const version = await latestVersionOf(MODEL);

  const response = await postPrediction(version, {
    image: dataUri,
    format: "png",
    // Transparent background rather than a matte colour — the normalizer trims to the
    // garment's true bounds, which needs real alpha.
    background_type: "rgba",
  });

  if (!response.ok) {
    throw new Error(`Replicate rejected the request (${response.status}): ${await response.text()}`);
  }

  const prediction = await awaitPrediction((await response.json()) as Prediction);

  const imageResponse = await fetch(firstOutputUrl(prediction));
  if (!imageResponse.ok) {
    throw new Error(`Could not download the result (${imageResponse.status}).`);
  }

  return Buffer.from(await imageResponse.arrayBuffer());
}

/** Binary mask of the clothing in the frame, hanger excluded. */
async function clothingMask(source: Buffer): Promise<Buffer> {
  const dataUri = `data:image/jpeg;base64,${source.toString("base64")}`;

  const version = await latestVersionOf(MASK_MODEL);
  const response = await postPrediction(version, {
    image: dataUri,
    mask_prompt: MASK_PROMPT,
    negative_mask_prompt: MASK_NEGATIVE_PROMPT,
    adjustment_factor: 0,
  });

  if (!response.ok) {
    throw new Error(`Mask request failed (${response.status}): ${await response.text()}`);
  }

  const prediction = await awaitPrediction((await response.json()) as Prediction);
  const outputs = Array.isArray(prediction.output)
    ? prediction.output
    : [prediction.output];

  // The model returns several images; we want the plain mask, not the annotated
  // previews or the inverted one. Matched by name rather than index, which is ordering
  // the model could change.
  const maskUrl = outputs.find(
    (url): url is string =>
      typeof url === "string" && /\/mask\.(jpg|png)$/.test(new URL(url).pathname),
  );

  if (!maskUrl) throw new Error("Mask model returned no plain mask.");

  const maskResponse = await fetch(maskUrl);
  if (!maskResponse.ok) throw new Error(`Could not download the mask (${maskResponse.status}).`);

  return Buffer.from(await maskResponse.arrayBuffer());
}

/**
 * Cut out a garment: crisp edges from salient-object segmentation, hanger removed by
 * gating that result against a prompt-guided clothing mask.
 *
 * Neither model does this alone. The crisp cutout treats the hanger as part of the
 * subject; the prompted mask knows what clothing is but traces it too loosely to cut
 * with. Multiplying one by the other keeps the precise edge and drops the hanger.
 */
export async function cutOutGarment(source: Buffer): Promise<Buffer> {
  const [cutout, mask] = await Promise.all([
    removeBackground(source),
    clothingMask(source),
  ]);

  const { width, height } = await sharp(cutout).metadata();
  if (!width || !height) throw new Error("Could not read cutout dimensions.");

  const gate = await sharp(mask)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .blur(GATE_BLUR)
    .linear(GATE_GAIN, GATE_OFFSET)
    .raw()
    .toBuffer();

  const alpha = await sharp(cutout).extractChannel("alpha").raw().toBuffer();

  const gated = Buffer.alloc(alpha.length);
  for (let i = 0; i < gated.length; i += 1) {
    gated[i] = Math.round((alpha[i] * Math.min(255, gate[i])) / 255);
  }

  const gatedAlpha = await sharp(gated, {
    raw: { width, height, channels: 1 },
  })
    .png()
    .toBuffer();

  const rgb = await sharp(cutout).removeAlpha().png().toBuffer();

  return sharp(rgb).ensureAlpha().joinChannel(gatedAlpha).png().toBuffer();
}
