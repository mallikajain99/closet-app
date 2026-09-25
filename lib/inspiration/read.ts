import type { Category } from "@prisma/client";

/**
 * Read the garments out of an inspiration photo.
 *
 * The one genuinely new capability in this feature, and the quality of everything
 * downstream depends on it: a piece the model doesn't see can never reach the shopping
 * list, and a piece it invents sends the user shopping for something that isn't in the
 * picture.
 *
 * Run through Replicate like the rest of the image work, because that is the only
 * model provider this app is configured for. `gpt-4o-mini` rather than a
 * captioning-only model: the output has to be *structured*, and asking a captioner for
 * JSON is how you get prose with braces in it.
 */

const MODEL = "openai/gpt-4o-mini";
const POLL_INTERVAL_MS = 1500;
const POLL_TIMEOUT_MS = 120_000;

/**
 * Categories the reader may use.
 *
 * Constrained to the closet's own vocabulary so matching has something to match on. A
 * free-text category would have to be mapped back anyway, and the mapping is exactly
 * where a "jumper"/"sweater" mismatch would silently drop a piece.
 */
const CATEGORIES: Category[] = [
  "TOP",
  "BOTTOM",
  "DRESS",
  "OUTERWEAR",
  "SHOE",
  "HAT",
  "BAG",
  "JEWELRY",
  "ACCESSORY",
];

const SYSTEM_PROMPT = `You identify the garments worn in a fashion photograph.

Reply with JSON only, in this shape:
{"pieces":[{"category":"TOP","subcategory":"cable-knit sweater","color":"cream","description":"cream cable-knit crewneck sweater"}]}

Rules:
- category must be one of: ${CATEGORIES.join(", ")}
- One entry per visible garment. Do not list a garment you cannot actually see.
- Do not guess at pieces hidden behind others, and do not include the person, the
  background, or anything that is not clothing.
- subcategory is the common name for the garment: "straight-leg jeans", "loafers".
- color is the plainest name for its colour: "cream", "mid-wash blue", "black".
- description is how someone would say it aloud, colour first.`;

export type ReadPiece = {
  category: Category;
  subcategory: string;
  color: string | null;
  description: string;
};

function token(): string {
  const value = process.env.REPLICATE_API_TOKEN;
  if (!value) throw new Error("REPLICATE_API_TOKEN is not set.");
  return value;
}

async function latestVersionOf(model: string): Promise<string> {
  const response = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!response.ok) {
    throw new Error(`Could not resolve ${model} (${response.status}).`);
  }
  const body = (await response.json()) as { latest_version?: { id?: string } };
  const id = body.latest_version?.id;
  if (!id) throw new Error(`${model} has no published version.`);
  return id;
}

/**
 * Pull the JSON object out of whatever the model replied with.
 *
 * Asked for JSON only, it usually obliges, and sometimes wraps it in a fenced code
 * block or a sentence. Taking the outermost braces is more forgiving than a parse of
 * the whole string and costs nothing when the reply was clean.
 */
function extractJson(text: string): unknown {
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start === -1 || end <= start) {
    throw new Error("The reader returned no JSON.");
  }
  return JSON.parse(text.slice(start, end + 1));
}

/** Keep only entries that are usable; a malformed one is dropped, never guessed at. */
function parsePieces(payload: unknown): ReadPiece[] {
  const raw = (payload as { pieces?: unknown }).pieces;
  if (!Array.isArray(raw)) return [];

  const pieces: ReadPiece[] = [];
  for (const entry of raw) {
    if (typeof entry !== "object" || entry === null) continue;
    const row = entry as Record<string, unknown>;

    const category = String(row.category ?? "").toUpperCase() as Category;
    if (!CATEGORIES.includes(category)) continue;

    const subcategory = String(row.subcategory ?? "").trim();
    const description = String(row.description ?? "").trim() || subcategory;
    if (!description) continue;

    const color = String(row.color ?? "").trim();
    pieces.push({ category, subcategory, color: color || null, description });
  }
  return pieces;
}

export async function readInspiration(imageUrl: string): Promise<ReadPiece[]> {
  const version = await latestVersionOf(MODEL);

  const created = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body: JSON.stringify({
      version,
      input: {
        system_prompt: SYSTEM_PROMPT,
        prompt: "List the garments worn in this photograph.",
        image_input: [imageUrl],
        temperature: 0.2,
        max_completion_tokens: 700,
      },
    }),
  });

  if (!created.ok) {
    throw new Error(`Reader request failed (${created.status}): ${await created.text()}`);
  }

  let prediction = (await created.json()) as {
    id: string;
    status: string;
    output?: unknown;
    error?: unknown;
  };

  const deadline = Date.now() + POLL_TIMEOUT_MS;
  while (prediction.status !== "succeeded" && prediction.status !== "failed") {
    if (Date.now() > deadline) throw new Error("The reader timed out.");
    await new Promise((resolve) => setTimeout(resolve, POLL_INTERVAL_MS));
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    prediction = (await poll.json()) as typeof prediction;
  }

  if (prediction.status === "failed") {
    throw new Error(`The reader failed: ${String(prediction.error ?? "unknown")}`);
  }

  // The model streams tokens, so the output arrives as an array of fragments.
  const text = Array.isArray(prediction.output)
    ? prediction.output.join("")
    : String(prediction.output ?? "");

  return parsePieces(extractJson(text));
}
