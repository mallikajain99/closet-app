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
/**
 * Broad on purpose. A garment the vocabulary has no word for comes back with a weak
 * mask — "vest" was absent and the suede waistcoat masked so poorly that its rope
 * toggles read as non-clothing.
 */
const MASK_PROMPT =
  "shirt,blouse,top,vest,waistcoat,clothing,garment,jacket,blazer,coat,cardigan,sweater,knitwear," +
  "trousers,pants,jeans,skirt,shorts,dress," +
  "shoe,shoes,sneaker,boot,boots,sandal,loafer,heel,footwear";
/**
 * Deliberately narrow. An earlier version included "hook,wire", which ate the rope
 * toggles off a suede vest — the model is right that a rope loop is hook-like. Only the
 * hanger itself and the backdrop need naming; the positive prompt does the rest.
 */
const MASK_NEGATIVE_PROMPT = "hanger,door,wall";

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
 * Longest edge of the image sent to Replicate.
 *
 * Sending the stored 2048px original as a base64 data URI meant ~550KB per request,
 * twice per item, and large TLS uploads were intermittently corrupting — "bad record
 * mac", surfacing downstream as a destroyed session. Both models operate around 1024px,
 * and the cut-out only needs to exceed the ~800px it's eventually drawn at, so the extra
 * pixels bought nothing and cost reliability.
 */
const REQUEST_MAX_EDGE = 1024;

/** Downscale and re-encode for transport; never upscales. */
async function forRequest(source: Buffer): Promise<string> {
  const prepared = await sharp(source)
    .resize({
      width: REQUEST_MAX_EDGE,
      height: REQUEST_MAX_EDGE,
      fit: "inside",
      withoutEnlargement: true,
    })
    .jpeg({ quality: 90 })
    .toBuffer();

  return `data:image/jpeg;base64,${prepared.toString("base64")}`;
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
  const dataUri = await forRequest(source);
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
  const dataUri = await forRequest(source);

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
 * Read a mask as one byte per pixel, at the cutout's dimensions.
 *
 * `info.channels` is read back rather than assumed: `.greyscale()` does not guarantee a
 * single-channel raw buffer, and indexing a 3-channel buffer as if it were 1-channel is
 * what produced the striped and translucent results in two earlier attempts at this.
 */
async function readMask(mask: Buffer, width: number, height: number) {
  const { data, info } = await sharp(mask)
    .resize(width, height, { fit: "fill" })
    .greyscale()
    .toColourspace("b-w")
    .raw()
    .toBuffer({ resolveWithObject: true });

  const bits = new Uint8Array(info.width * info.height);
  for (let i = 0; i < bits.length; i += 1) {
    bits[i] = data[i * info.channels] >= 128 ? 1 : 0;
  }

  return { bits, width: info.width, height: info.height };
}

/**
 * Fill the mask's interior holes — the crux of the whole problem.
 *
 * Where a hanger crosses a garment, the clothing mask has a hole punched in it, and
 * gating the cutout by it pushes that hole straight through the fabric: a gap at a
 * cardigan's neck, toggles eaten off a suede vest. But the gate only needs to say
 * *where clothing is*; the crisp alpha already supplies the actual shape. So any
 * enclosed gap can be filled without consequence — filling only ever means "don't
 * erase here", and wherever the garment genuinely has an opening the crisp alpha is
 * already transparent.
 *
 * Interior is defined by reachability: flood the background inward from the border, and
 * any unlit background pixel is enclosed by clothing and therefore a hole.
 */
function fillInteriorHoles(bits: Uint8Array, width: number, height: number) {
  const outside = new Uint8Array(width * height);
  const stack: number[] = [];

  const visit = (index: number) => {
    if (bits[index] || outside[index]) return;
    outside[index] = 1;
    stack.push(index);
  };

  for (let x = 0; x < width; x += 1) {
    visit(x);
    visit((height - 1) * width + x);
  }
  for (let y = 0; y < height; y += 1) {
    visit(y * width);
    visit(y * width + width - 1);
  }

  while (stack.length > 0) {
    const index = stack.pop()!;
    const x = index % width;
    const y = (index - x) / width;
    if (x > 0) visit(index - 1);
    if (x < width - 1) visit(index + 1);
    if (y > 0) visit(index - width);
    if (y < height - 1) visit(index + width);
  }

  const filled = new Uint8Array(width * height);
  for (let i = 0; i < filled.length; i += 1) {
    filled[i] = bits[i] || !outside[i] ? 1 : 0;
  }
  return filled;
}

/**
 * Grow the gate outwards by roughly `sigma` pixels.
 *
 * The prompted mask traces the garment loosely and often lands a few pixels inside the
 * true edge, which would shave a collar or a cuff. Blur-then-threshold is a dilation
 * without hand-rolled morphology: blurring bleeds coverage outwards and a low threshold
 * keeps everything it bled into.
 */
async function growGate(filled: Uint8Array, width: number, height: number, sigma: number) {
  const gray = Buffer.alloc(width * height);
  for (let i = 0; i < gray.length; i += 1) gray[i] = filled[i] ? 255 : 0;

  const { data, info } = await sharp(gray, { raw: { width, height, channels: 1 } })
    .blur(sigma)
    .threshold(40)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const gate = new Uint8Array(width * height);
  for (let i = 0; i < gate.length; i += 1) {
    gate[i] = data[i * info.channels] >= 128 ? 255 : 0;
  }
  return gate;
}

/** Per-pixel alpha of the crisp cutout, one byte per pixel. */
async function readAlpha(cutout: Buffer) {
  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i += 1) {
    alpha[i] = data[i * info.channels];
  }
  return alpha;
}

/**
 * Erase only the non-clothing regions that begin *above* the garment.
 *
 * Treating "not clothing" as "erase" is what kept damaging garments: the mask misses
 * rope trim, a pale pinstripe, the inside of a lapel, and the gate then bites a hole
 * wherever it was wrong. Hole-filling covers enclosed gaps but not an opening that runs
 * to the hem — a vest's front placket connects straight to the outside background, so
 * anything crossing it was still erased.
 *
 * What is reliably true is the geometry: whatever holds a garment up sits *outside* it —
 * a hanger above, a display stand below. So each non-clothing island is kept or erased
 * as a whole, by whether it reaches beyond the garment's vertical extent. A hook and its
 * bar are one connected island reaching above the top edge, so the bar goes too even
 * though it overlaps the shoulders; a stand's pedestal reaches below the hem. Toggles,
 * cuffs and plackets lie wholly between the two lines and are unreachable by
 * construction.
 *
 * Returns the per-pixel alpha multiplier, and what fraction of the garment it erases.
 */
/**
 * A bar seen *through* an opening in the garment.
 *
 * The other rule here is "whatever holds a garment up sits outside it", which is true
 * of the hook and the arms but not of the length of hanger framed by a neckline — that
 * sits inside the garment's box on every side, so the geometry test kept it and a black
 * bar survived across the collar of every scoop- and square-necked top.
 *
 * What is still true is its *shape*: a hanger bar is wide, thin, level, and high on the
 * garment. A garment feature the mask missed — a collar band, a cuff, a pinstripe — is
 * none of those at once. All four have to hold, and the safety valve still has the last
 * word if the mask turns out to be describing something else entirely.
 */
function looksLikeABar(
  box: { minRow: number; maxRow: number; minCol: number; maxCol: number },
  garment: { top: number; bottom: number; left: number; right: number },
  height: number,
) {
  const barWidth = box.maxCol - box.minCol + 1;
  const barHeight = box.maxRow - box.minRow + 1;
  const garmentWidth = Math.max(1, garment.right - garment.left + 1);
  const garmentHeight = Math.max(1, garment.bottom - garment.top + 1);

  return (
    barWidth >= garmentWidth * 0.25 &&
    barHeight <= Math.max(4, height * 0.035) &&
    barWidth >= barHeight * 4 &&
    // Hangers hang from the shoulders. A band low on a skirt is the garment's own.
    box.maxRow <= garment.top + garmentHeight * 0.35
  );
}

function eraseOutside(
  alpha: Uint8Array,
  gate: Uint8Array,
  width: number,
  height: number,
  garmentTop: number,
  garmentBottom: number,
  garmentLeft: number,
  garmentRight: number,
  holes: Uint8Array,
) {
  const keep = new Uint8Array(alpha.length).fill(255);
  const visited = new Uint8Array(alpha.length);
  /**
   * Opaque, and something the mask did not call clothing.
   *
   * `holes` re-admits what hole-filling took away. Filling an enclosed region of the
   * mask means "don't erase here", which is right for lace the mask missed and wrong
   * for a hanger bar framed by a neckline — both are enclosed by garment. Re-admitting
   * them as *candidates* costs nothing, because an island inside the garment is only
   * ever erased if it is also bar-shaped.
   */
  const candidate = (i: number) => alpha[i] >= 128 && (gate[i] < 128 || holes[i] === 1);

  let opaque = 0;
  for (let i = 0; i < alpha.length; i += 1) if (alpha[i] >= 128) opaque += 1;

  let erased = 0;

  // Clear the *semi-transparent* pixels outside the garment. A white hanger on a pale
  // backdrop comes back with partial alpha, so it is invisible to the island pass below
  // — which only considers pixels more opaque than not — and survived as a ghost
  // outline. Fully opaque pixels are left to that pass, which consults the gate before
  // erasing: clearing these bands unconditionally bit a notch out of a cardigan collar
  // whenever the coarse mask put the garment's top edge below the true one.
  for (let i = 0; i < alpha.length; i += 1) {
    const x = i % width;
    const y = (i - x) / width;
    // Outside the garment's box on *either* axis. Vertical alone left the ghost of a
    // pale hanger arm lying level with the shoulders of a cropped top.
    if (y >= garmentTop && y <= garmentBottom && x >= garmentLeft && x <= garmentRight) {
      continue;
    }
    if (alpha[i] >= 128) continue;
    keep[i] = 0;
  }

  for (let start = 0; start < alpha.length; start += 1) {
    if (visited[start] || !candidate(start)) continue;

    // Collect one island, tracking the highest row it reaches.
    const island: number[] = [];
    const stack = [start];
    visited[start] = 1;
    let minRow = height;
    let maxRow = 0;
    let minCol = width;
    let maxCol = 0;

    while (stack.length > 0) {
      const index = stack.pop()!;
      island.push(index);

      const x = index % width;
      const y = (index - x) / width;
      if (y < minRow) minRow = y;
      if (y > maxRow) maxRow = y;
      if (x < minCol) minCol = x;
      if (x > maxCol) maxCol = x;

      const neighbours = [
        x > 0 ? index - 1 : -1,
        x < width - 1 ? index + 1 : -1,
        y > 0 ? index - width : -1,
        y < height - 1 ? index + width : -1,
      ];
      for (const n of neighbours) {
        if (n < 0 || visited[n] || !candidate(n)) continue;
        visited[n] = 1;
        stack.push(n);
      }
    }

    // Only a region enclosed by the garment can be something seen *through* it. A
    // contrast neck binding is attached to the garment's outer edge, not framed by it,
    // so it never qualifies however bar-like its shape.
    let inHole = 0;
    for (const index of island) if (holes[index] === 1) inHole += 1;
    const framed = inHole > island.length * 0.8;

    const inside =
      minRow >= garmentTop &&
      maxRow <= garmentBottom &&
      // Horizontal extent too, not just vertical. A hanger's arms sit level with the
      // shoulders of a cropped top, so a vertical-only test declared the whole hanger
      // "inside the garment" and kept it.
      minCol >= garmentLeft &&
      maxCol <= garmentRight;

    if (
      inside &&
      !(framed &&
        looksLikeABar(
        { minRow, maxRow, minCol, maxCol },
        { top: garmentTop, bottom: garmentBottom, left: garmentLeft, right: garmentRight },
        height,
      ))
    ) {
      continue;
    }

    for (const index of island) {
      if (keep[index] === 0) continue; // already cleared by the band above
      keep[index] = 0;
      erased += 1;
    }
  }

  return { keep, erasedFraction: opaque === 0 ? 0 : erased / opaque };
}

/**
 * The safety valve. On a pale garment against a pale backdrop the prompted mask can come
 * back nearly empty — that is what reduced a grey pinstripe top to a handful of
 * fragments. Erasing this much of the subject means the mask is not describing this
 * garment, so it gets discarded rather than trusted.
 */
const MAX_ERASED_FRACTION = 0.25;

/**
 * The first row of the image containing a meaningful amount of clothing.
 *
 * The fallback for when the gate is untrustworthy. The hanger's hook sits entirely
 * *above* the garment, so clearing everything above the garment's top edge removes the
 * hook without touching a single pixel of the garment — holes are impossible by
 * construction. It leaves the hanger's bar behind, which is why it isn't the default.
 */
function clothingTopRow(bits: Uint8Array, width: number, height: number) {
  return clothingRow(bits, width, height, "top");
}

/**
 * The first or last row containing a meaningful amount of clothing.
 *
 * A row counts as clothing once enough of it is opaque, so a stray speck of noise or a
 * sliver of misclassified support structure doesn't set the boundary.
 */
function clothingRow(
  bits: Uint8Array,
  width: number,
  height: number,
  edge: "top" | "bottom",
) {
  const minRunPixels = Math.max(8, Math.round(width * 0.02));

  for (let step = 0; step < height; step += 1) {
    const y = edge === "top" ? step : height - 1 - step;
    let opaque = 0;
    const rowStart = y * width;
    for (let x = 0; x < width; x += 1) {
      if (bits[rowStart + x]) opaque += 1;
    }
    if (opaque >= minRunPixels) return y;
  }

  return edge === "top" ? 0 : height - 1;
}

/** The leftmost or rightmost column the garment reaches, mirroring `clothingRow`. */
function clothingColumn(
  bits: Uint8Array,
  width: number,
  height: number,
  edge: "left" | "right",
) {
  const minRunPixels = Math.max(8, Math.round(height * 0.02));

  for (let step = 0; step < width; step += 1) {
    const x = edge === "left" ? step : width - 1 - step;
    let opaque = 0;
    for (let y = 0; y < height; y += 1) {
      if (bits[y * width + x]) opaque += 1;
    }
    if (opaque >= minRunPixels) return x;
  }

  return edge === "left" ? 0 : width - 1;
}

/** Erase the band above the garment, leaving the garment itself untouched. */
async function clearAbove(cutout: Buffer, width: number, cutRow: number) {
  if (cutRow <= 0) return cutout;

  // `dest-out` erases wherever the overlay has coverage, so a fully opaque rectangle
  // punches that band to transparent.
  return sharp(cutout)
    .composite([
      {
        input: {
          create: {
            width,
            height: cutRow,
            channels: 4,
            background: { r: 0, g: 0, b: 0, alpha: 1 },
          },
        },
        left: 0,
        top: 0,
        blend: "dest-out",
      },
    ])
    .png()
    .toBuffer();
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
  /**
   * The mask is an enhancement, never a prerequisite.
   *
   * When the prompt matches nothing in the frame, grounded_sam returns an empty tensor
   * and the prediction dies with "cannot reshape tensor of 0 elements" — which used to
   * fail the whole item, losing a perfectly good background-removed cutout over a
   * hanger that might not even be there. Falling back to the plain cutout keeps the
   * garment; the worst case is a support structure left in frame.
   */
  const [cutout, mask] = await Promise.all([
    removeBackground(source),
    clothingMask(source).catch((error: unknown) => {
      // Only a genuine "the model found nothing" is a reason to skip the gate. A
      // transport failure must propagate so the caller's retry can handle it —
      // swallowing it here produced a hanger-included cutout and marked it DONE, which
      // is a silent downgrade and worse than failing the item.
      const message = error instanceof Error ? error.message : String(error);
      if (!/cannot reshape tensor of 0 elements|no plain mask/i.test(message)) throw error;
      console.log(`    no clothing matched the mask prompt — keeping the plain cutout`);
      return null;
    }),
  ]);

  if (!mask) return cutout;

  const { width, height } = await sharp(cutout).metadata();
  if (!width || !height) throw new Error("Could not read cutout dimensions.");

  const { bits } = await readMask(mask, width, height);
  const filled = fillInteriorHoles(bits, width, height);
  // What hole-filling added: the regions the garment encloses. Kept so the island pass
  // can tell "behind the garment" from "part of it".
  const holes = new Uint8Array(filled.length);
  for (let i = 0; i < filled.length; i += 1) holes[i] = filled[i] && !bits[i] ? 1 : 0;
  // Generous. A thin feature the mask missed — a ribbed collar band, a cuff — otherwise
  // reads as non-clothing, joins the hanger's island, and is erased along with it, which
  // bit a notch out of a cardigan collar. Growing the gate bridges those gaps; the cost
  // is a few pixels of hanger surviving where it runs close alongside the garment.
  const gate = await growGate(filled, width, height, Math.max(3, height * 0.014));
  const alpha = await readAlpha(cutout);

  // The garment's top edge comes from the *grown* gate, so a loosely traced mask errs
  // towards a higher line — which spares a collar at the cost of leaving a little hook.
  const gateBits = new Uint8Array(gate.length);
  for (let i = 0; i < gate.length; i += 1) gateBits[i] = gate[i] >= 128 ? 1 : 0;
  const margin = Math.round(height * 0.01);
  const garmentTop = Math.max(0, clothingRow(gateBits, width, height, "top") - margin);
  const garmentBottom = Math.min(
    height - 1,
    clothingRow(gateBits, width, height, "bottom") + margin,
  );
  const garmentLeft = Math.max(0, clothingColumn(gateBits, width, height, "left") - margin);
  const garmentRight = Math.min(
    width - 1,
    clothingColumn(gateBits, width, height, "right") + margin,
  );

  const { keep, erasedFraction } = eraseOutside(
    alpha,
    gate,
    width,
    height,
    garmentTop,
    garmentBottom,
    garmentLeft,
    garmentRight,
    holes,
  );

  // Fall back to the approach that cannot damage fabric, and accept the bar.
  if (erasedFraction > MAX_ERASED_FRACTION) {
    const topRow = clothingTopRow(bits, width, height);
    return clearAbove(cutout, width, Math.max(0, topRow - Math.round(height * 0.01)));
  }

  // `dest-in` keeps the destination only where the overlay is opaque, so an RGBA overlay
  // carrying the keep mask in its alpha channel erases the hanger while leaving every
  // edge the cutout found intact.
  const overlay = Buffer.alloc(width * height * 4);
  for (let i = 0; i < keep.length; i += 1) overlay[i * 4 + 3] = keep[i];

  return sharp(cutout)
    .composite([
      {
        input: overlay,
        raw: { width, height, channels: 4 },
        blend: "dest-in",
      },
    ])
    .png()
    .toBuffer();
}

