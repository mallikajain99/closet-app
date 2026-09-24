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
  // Straps named explicitly. A spaghetti strap is a few pixels wide and the model was
  // missing it, so it read as non-clothing, joined the hanger's island and was erased
  // with it — every camisole came back strapless.
  "camisole,tank top,bodysuit,strap,straps,shoulder strap," +
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

/** Binary mask of whatever the prompt names. */
async function promptedMask(
  source: Buffer,
  maskPrompt: string,
  negativePrompt: string,
): Promise<Buffer> {
  const dataUri = await forRequest(source);

  const version = await latestVersionOf(MASK_MODEL);
  const response = await postPrediction(version, {
    image: dataUri,
    mask_prompt: maskPrompt,
    negative_mask_prompt: negativePrompt,
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

/** Binary mask of the clothing in the frame, hanger excluded. */
export async function clothingMask(source: Buffer): Promise<Buffer> {
  return promptedMask(source, MASK_PROMPT, MASK_NEGATIVE_PROMPT);
}

/**
 * Binary mask of the support structure — the thing to erase, named positively.
 *
 * The whole module used to work by subtraction: erase what the clothing mask does not
 * call clothing. That is the assumption every failure here has come from, because a
 * coarse mask misses rope toggles, ribbed collar bands, pale pinstripes and spaghetti
 * straps, and each omission read as something to delete. Every fix since has been a
 * geometric rule bolted on to stop the subtraction eating a garment.
 *
 * Asking where the *hanger* is inverts that. A pixel is only erased when two
 * independent models agree — this one says hanger, and the clothing mask declines to
 * say clothing. A missed strap is then merely not-clothing, which no longer means
 * anything on its own.
 */
export async function hangerMask(source: Buffer): Promise<Buffer> {
  return promptedMask(
    source,
    "clothes hanger,coat hanger,hanger,clothes hanger hook",
    // The garment, so the model is pushed away from calling fabric part of the hanger.
    "clothing,garment,shirt,dress,trousers,fabric",
  );
}

/**
 * Read a mask as one byte per pixel, at the cutout's dimensions.
 *
 * `info.channels` is read back rather than assumed: `.greyscale()` does not guarantee a
 * single-channel raw buffer, and indexing a 3-channel buffer as if it were 1-channel is
 * what produced the striped and translucent results in two earlier attempts at this.
 */
export async function readMask(mask: Buffer, width: number, height: number) {
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
export function fillInteriorHoles(bits: Uint8Array, width: number, height: number) {
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
export async function growGate(filled: Uint8Array, width: number, height: number, sigma: number) {
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
export async function readAlpha(cutout: Buffer) {
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
  hangerRows: { minRow: number; maxRow: number } | null,
) {
  const barWidth = box.maxCol - box.minCol + 1;
  const barHeight = box.maxRow - box.minRow + 1;
  const garmentWidth = Math.max(1, garment.right - garment.left + 1);
  const garmentHeight = Math.max(1, garment.bottom - garment.top + 1);

  // A velvet hanger bar measures about 5% of the frame's height. The first version of
  // this said 3.5%, which is why the rule never once fired on the garments it was
  // written for — measured at 302×53 in a 1024-tall frame, it failed on thickness
  // alone.
  const thin = barHeight <= Math.max(4, height * 0.06);

  const barLike =
    barWidth >= garmentWidth * 0.25 &&
    thin &&
    barWidth >= barHeight * 4 &&
    // Hangers hang from the shoulders. A band low on a skirt is the garment's own.
    box.maxRow <= garment.top + garmentHeight * 0.35;

  if (!barLike) return false;

  /**
   * And it has to line up with hanger we already removed.
   *
   * Shape alone would also describe a contrast collar band or a wide yoke seam the
   * mask happened to miss, and erasing one of those is the damage this module keeps
   * having to avoid. What is unique to the neckline bar is that it is the *same bar*
   * as the one erased outside the garment, just the stretch framed by the opening — so
   * it lies in the same rows. No hanger removed outside means no bar inside.
   */
  if (!hangerRows) return false;
  return box.minRow <= hangerRows.maxRow && box.maxRow >= hangerRows.minRow;
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
  /** Where two models agree there is a hanger; null when they found nothing. */
  agreed: Uint8Array | null,
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

  /**
   * Collected before anything is erased, in two phases.
   *
   * Judging the bar framed by a neckline needs to know where the hanger outside the
   * garment was, and that is only known once every island has been seen — so the scan
   * gathers them all first and decides afterwards.
   */
  type Island = {
    pixels: number[];
    minRow: number;
    maxRow: number;
    minCol: number;
    maxCol: number;
  };
  const islands: Island[] = [];

  for (let start = 0; start < alpha.length; start += 1) {
    if (visited[start] || !candidate(start)) continue;

    const pixels: number[] = [];
    const stack = [start];
    visited[start] = 1;
    let minRow = height;
    let maxRow = 0;
    let minCol = width;
    let maxCol = 0;

    while (stack.length > 0) {
      const index = stack.pop()!;
      pixels.push(index);

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

    islands.push({ pixels, minRow, maxRow, minCol, maxCol });
  }

  /**
   * Which pixels of a doomed island actually go.
   *
   * A spaghetti strap loops over the hanger, so strap and hanger arrive as one island
   * and erasing the island whole took every camisole's straps with it. Taking the
   * hanger out first breaks that join: what is left falls into separate pieces, and a
   * strap is distinguishable from a hanger arm by being taller than it is wide.
   *
   * With no hanger mask to subtract — a pale wire hanger the model missed — the whole
   * island is one wide piece and goes as before, which is the recall this pass exists
   * for.
   */
  const survivors = (island: Island): number[] => {
    if (!agreed) return island.pixels;

    const remaining = island.pixels.filter((index) => agreed[index] !== 1);
    if (remaining.length === 0) return island.pixels;

    const inIsland = new Set(remaining);
    const seen = new Set<number>();
    const doomed: number[] = island.pixels.filter((index) => agreed[index] === 1);

    for (const start of remaining) {
      if (seen.has(start)) continue;

      const piece: number[] = [];
      const stack = [start];
      seen.add(start);
      let minRow = height, maxRow = 0, minCol = width, maxCol = 0;

      while (stack.length > 0) {
        const index = stack.pop()!;
        piece.push(index);
        const x = index % width;
        const y = (index - x) / width;
        if (y < minRow) minRow = y;
        if (y > maxRow) maxRow = y;
        if (x < minCol) minCol = x;
        if (x > maxCol) maxCol = x;

        for (const n of [
          x > 0 ? index - 1 : -1,
          x < width - 1 ? index + 1 : -1,
          y > 0 ? index - width : -1,
          y < height - 1 ? index + width : -1,
        ]) {
          if (n < 0 || seen.has(n) || !inIsland.has(n)) continue;
          seen.add(n);
          stack.push(n);
        }
      }

      // Taller than wide, and reaching down to the garment: a strap. Anything else
      // left over once the hanger is removed is more hanger.
      //
      // Only just taller than wide, not twice as tall — a camisole strap runs out
      // diagonally to the hanger's arm, so demanding 2:1 spared the steep straps and
      // cut the splayed ones off the same garment type. A hanger arm fails this the
      // other way round: it is far wider than it is tall.
      const strapLike = maxRow - minRow > maxCol - minCol && maxRow >= garmentTop;
      if (!strapLike) doomed.push(...piece);
    }

    return doomed;
  };

  // Horizontal extent too, not just vertical. A hanger's arms sit level with the
  // shoulders of a cropped top, so a vertical-only test declared the whole hanger
  // "inside the garment" and kept it.
  const escapes = (island: Island) =>
    island.minRow < garmentTop ||
    island.maxRow > garmentBottom ||
    island.minCol < garmentLeft ||
    island.maxCol > garmentRight;

  // The rows the support structure occupied, which is what a bar inside the garment
  // has to line up with to be believed.
  let hangerRows: { minRow: number; maxRow: number } | null = null;
  for (const island of islands) {
    if (!escapes(island)) continue;
    hangerRows = hangerRows
      ? {
          minRow: Math.min(hangerRows.minRow, island.minRow),
          maxRow: Math.max(hangerRows.maxRow, island.maxRow),
        }
      : { minRow: island.minRow, maxRow: island.maxRow };
  }

  for (const island of islands) {
    const doomed =
      escapes(island) ||
      looksLikeABar(
        island,
        { top: garmentTop, bottom: garmentBottom, left: garmentLeft, right: garmentRight },
        height,
        hangerRows,
      );
    if (!doomed) continue;

    for (const index of survivors(island)) {
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
export function clothingRow(
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
export function clothingColumn(
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
 * Punch the keep mask into the cutout's alpha.
 *
 * `dest-in` keeps the destination only where the overlay is opaque, so an RGBA overlay
 * carrying the keep mask in its alpha channel erases the hanger while leaving every
 * edge the cutout found intact.
 */
async function applyKeep(
  cutout: Buffer,
  keep: Uint8Array,
  width: number,
  height: number,
): Promise<Buffer> {
  const overlay = Buffer.alloc(width * height * 4);
  for (let i = 0; i < keep.length; i += 1) overlay[i * 4 + 3] = keep[i];

  return sharp(cutout)
    .composite([{ input: overlay, raw: { width, height, channels: 4 }, blend: "dest-in" }])
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
  const emptyMaskIsFine = (error: unknown) => {
    const message = error instanceof Error ? error.message : String(error);
    if (!/cannot reshape tensor of 0 elements|no plain mask/i.test(message)) throw error;
    return null;
  };

  const [cutout, mask, hanger] = await Promise.all([
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
    // Nothing hanger-shaped in frame is a perfectly ordinary answer — a flat-lay, or a
    // retailer's product shot — so it falls back rather than failing.
    hangerMask(source).catch(emptyMaskIsFine),
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

  /**
   * Where two models agree there is a hanger.
   *
   * `hanger` says where the support structure is; `gate` is the clothing mask, grown,
   * and its refusal to call a pixel clothing is the second opinion. Requiring both is
   * what makes this safe to apply directly: the hanger mask alone would be trusted
   * per-pixel, which is the mistake this module has made in every other form.
   *
   * When it finds anything, it *is* the answer — no geometry, no islands, no rules
   * about what a bar looks like. A strap the clothing mask missed is simply
   * not-clothing, which on its own now means nothing at all.
   */
  let agreed: Uint8Array | null = null;
  if (hanger) {
    const { bits: hangerBits } = await readMask(hanger, width, height);
    // Grown a little, because the mask traces the bar a few pixels inside its edge and
    // a surviving dark fringe reads as the whole hanger still being there.
    const grown = await growGate(hangerBits, width, height, Math.max(2, height * 0.004));

    let overlap = 0;
    agreed = new Uint8Array(alpha.length);
    for (let i = 0; i < alpha.length; i += 1) {
      const isHanger = grown[i] >= 128 && gate[i] < 128 && alpha[i] > 0;
      agreed[i] = isHanger ? 1 : 0;
      if (isHanger) overlap += 1;
    }
    // An empty agreement means the models did not corroborate each other; fall through
    // to the geometric pass rather than declaring the frame hanger-free.
    if (overlap < Math.max(64, width * height * 0.0002)) agreed = null;
  }

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
    agreed,
  );

  // Fall back to the approach that cannot damage fabric, and accept the bar. Logged,
  // because a silent fallback looks identical to the gate simply not working — which
  // cost an evening of debugging a rule that was firing correctly and then being
  // thrown away.
  if (erasedFraction > MAX_ERASED_FRACTION) {
    console.log(
      `    mask wanted ${(erasedFraction * 100).toFixed(0)}% of the garment — discarded, cropping above instead`,
    );
    const topRow = clothingTopRow(bits, width, height);
    return clearAbove(cutout, width, Math.max(0, topRow - Math.round(height * 0.01)));
  }

  return applyKeep(cutout, keep, width, height);
}

