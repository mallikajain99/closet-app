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
let cachedVersion: string | undefined;

async function latestVersion(): Promise<string> {
  if (cachedVersion) return cachedVersion;

  const response = await fetch(`https://api.replicate.com/v1/models/${MODEL}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!response.ok) {
    throw new Error(`Could not resolve ${MODEL} (${response.status}).`);
  }

  const model = (await response.json()) as { latest_version?: { id?: string } };
  if (!model.latest_version?.id) throw new Error(`${MODEL} has no published version.`);

  cachedVersion = model.latest_version.id;
  return cachedVersion;
}

/**
 * Create a prediction, waiting out rate limiting.
 *
 * Accounts without a payment method are capped at a few predictions per minute, and
 * Replicate says exactly how long to wait — so honour `retry_after` rather than failing
 * the item and forcing a re-run.
 */
async function postPrediction(version: string, dataUri: string, attempts = 4) {
  let response!: Response;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    response = await fetch("https://api.replicate.com/v1/predictions", {
      method: "POST",
      headers: {
        Authorization: `Bearer ${token()}`,
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        version,
        input: {
          image: dataUri,
          format: "png",
          // Transparent background rather than a matte colour — the normalizer trims to
          // the garment's true bounds, which needs real alpha.
          background_type: "rgba",
        },
      }),
    });

    if (response.status !== 429 || attempt === attempts) return response;

    const body = (await response.clone().json().catch(() => ({}))) as { retry_after?: number };
    const waitMs = Math.max(1, body.retry_after ?? 10) * 1000 + 500;
    console.log(`    rate limited — waiting ${Math.round(waitMs / 1000)}s`);
    await sleep(waitMs);
  }

  return response;
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
  const version = await latestVersion();

  const response = await postPrediction(version, dataUri);

  if (!response.ok) {
    throw new Error(`Replicate rejected the request (${response.status}): ${await response.text()}`);
  }

  let prediction = (await response.json()) as Prediction;

  // `Prefer: wait` usually returns a finished prediction, but falls back to polling when
  // the model is cold and takes longer than the hold.
  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (prediction.status === "starting" || prediction.status === "processing") {
    if (Date.now() > deadline) throw new Error("Segmentation timed out.");
    await sleep(POLL_INTERVAL_MS);

    const pollUrl = prediction.urls?.get ?? `https://api.replicate.com/v1/predictions/${prediction.id}`;
    const polled = await fetch(pollUrl, { headers: { Authorization: `Bearer ${token()}` } });
    if (!polled.ok) throw new Error(`Polling failed (${polled.status}).`);
    prediction = (await polled.json()) as Prediction;
  }

  if (prediction.status !== "succeeded") {
    throw new Error(`Segmentation ${prediction.status}: ${prediction.error ?? "no detail"}`);
  }

  const imageResponse = await fetch(firstOutputUrl(prediction));
  if (!imageResponse.ok) {
    throw new Error(`Could not download the result (${imageResponse.status}).`);
  }

  return Buffer.from(await imageResponse.arrayBuffer());
}
