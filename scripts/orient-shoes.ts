/**
 * Make every shoe face the same way.
 *
 *   npx tsx scripts/orient-shoes.ts                # report only
 *   npx tsx scripts/orient-shoes.ts --apply        # flip and re-upload
 *
 * A grid of shoes pointing in random directions reads as a jumble, and on the outfit
 * figure a right-facing shoe under a left-facing one looks like two different outfits.
 *
 * **Direction is read by the vision model, not measured from the pixels.** The obvious
 * geometric approach — a shoe is taller at the heel than the toe, so take the weighted
 * centroid of column heights — was tried first and is close to useless here: most of
 * these photographs are *pairs*, which are roughly symmetric, and the centroids came
 * out between 0.41 and 0.58 on a scale where 0.5 is "no idea". It mislabelled about a
 * third of them.
 *
 * The model is also the only thing that can return the answer that matters most:
 * `front`, for a pair photographed toes-toward-the-camera, where "pointing left" is not
 * a property the image has. Those are left alone rather than flipped on a guess.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";

import { PROCESSED_BUCKET } from "@/lib/images/storage.client";

loadEnv({ path: ".env.local", quiet: true });

const MODEL = "openai/gpt-4o-mini";
const APPLY = process.argv.includes("--apply");

/**
 * Restrict the flip to specific items, by id prefix.
 *
 * The model is good but not unanimous: on one run it called a pair of cream mules
 * right-facing while calling a near-identical pair of embellished mules left-facing,
 * and the cream pair was plainly left. Flipping an image is visible and the reader
 * cannot tell a mistake from a photograph, so the reading is a recommendation and this
 * flag is how you accept part of it.
 */
/**
 * Flip the `--only` items without asking the model again.
 *
 * Once a reading has been checked by eye, re-querying is a second coin toss on a
 * question already settled — and it is the step that fails when the account is out of
 * credit. `--only <ids> --force --apply` says "I have looked; mirror these".
 */
const FORCE = process.argv.includes("--force");

const ONLY = (() => {
  const index = process.argv.indexOf("--only");
  if (index === -1) return null;
  const ids = (process.argv[index + 1] ?? "").split(",").filter(Boolean);
  return ids.length ? ids : null;
})();

const SYSTEM_PROMPT = `You are looking at a cut-out photograph of a shoe or a pair of shoes.

Answer only: which way does the TOE point, from the viewer's perspective?

Reply with exactly one word:
  left   - the toe or toes point to the viewer's left
  right  - the toe or toes point to the viewer's right
  front  - the toes point toward the viewer, or away from them, so there is no
           meaningful left or right

If the two shoes in a pair point in opposite directions, answer for the shoe whose
whole profile is most visible. If you are genuinely unsure, answer front.`;

function token(): string {
  const value = process.env.REPLICATE_API_TOKEN;
  if (!value) throw new Error("REPLICATE_API_TOKEN missing — see SETUP.md.");
  return value;
}

async function latestVersionOf(model: string): Promise<string> {
  const response = await fetch(`https://api.replicate.com/v1/models/${model}`, {
    headers: { Authorization: `Bearer ${token()}` },
  });
  if (!response.ok) throw new Error(`Could not resolve ${model} (${response.status}).`);
  const body = (await response.json()) as { latest_version?: { id?: string } };
  const id = body.latest_version?.id;
  if (!id) throw new Error(`${model} has no published version.`);
  return id;
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Start a prediction, waiting out the rate limiter rather than failing on it.
 *
 * Replicate drops the account to 6 predictions a minute with a burst of 1 while the
 * balance is under $5, which is low enough that a plain loop over 27 shoes throttles on
 * every request after the first. The 429 body carries `retry_after` in seconds; honour
 * it rather than guessing a backoff, and the whole run costs about four minutes.
 */
async function createPrediction(body: string, attempt = 0): Promise<Response> {
  const response = await fetch("https://api.replicate.com/v1/predictions", {
    method: "POST",
    headers: {
      Authorization: `Bearer ${token()}`,
      "Content-Type": "application/json",
      Prefer: "wait",
    },
    body,
  });

  if (response.status !== 429 || attempt >= 6) return response;

  const text = await response.text();
  const wait = Number(JSON.parse(text)?.retry_after ?? 10);
  await sleep((Number.isFinite(wait) ? wait : 10) * 1000 + 500);
  return createPrediction(body, attempt + 1);
}

async function readDirection(version: string, imageUrl: string): Promise<string> {
  const created = await createPrediction(
    JSON.stringify({
      version,
      input: {
        system_prompt: SYSTEM_PROMPT,
        prompt: "Which way does the toe point?",
        image_input: [imageUrl],
        temperature: 0,
        max_completion_tokens: 8,
      },
    }),
  );
  if (!created.ok) {
    throw new Error(`Request failed (${created.status}): ${await created.text()}`);
  }

  let prediction = (await created.json()) as {
    id: string;
    status: string;
    output?: unknown;
    error?: unknown;
  };

  const deadline = Date.now() + 90_000;
  while (prediction.status !== "succeeded" && prediction.status !== "failed") {
    if (Date.now() > deadline) throw new Error("Timed out.");
    await sleep(1_200);
    const poll = await fetch(`https://api.replicate.com/v1/predictions/${prediction.id}`, {
      headers: { Authorization: `Bearer ${token()}` },
    });
    prediction = (await poll.json()) as typeof prediction;
  }
  if (prediction.status === "failed") {
    throw new Error(`Failed: ${String(prediction.error ?? "unknown")}`);
  }

  const text = Array.isArray(prediction.output)
    ? prediction.output.join("")
    : String(prediction.output ?? "");
  return text.trim().toLowerCase().replace(/[^a-z]/g, "");
}

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Shoes, plus anything named like hosiery that is photographed the same way.
  const items = await db.item.findMany({
    where: {
      processingStatus: "DONE",
      processedImageKey: { not: null },
      OR: [
        { category: "SHOE" },
        { name: { contains: "sock", mode: "insensitive" } },
        { subcategory: { contains: "sock", mode: "insensitive" } },
      ],
    },
    select: { id: true, name: true, processedImageKey: true, thumbnailKey: true },
    orderBy: { name: "asc" },
  });

  const version = FORCE ? "" : await latestVersionOf(MODEL);
  const counts: Record<string, number> = { left: 0, right: 0, front: 0, unknown: 0 };
  const flipped: string[] = [];

  for (const item of items) {
    if (ONLY && !ONLY.some((prefix) => item.id.startsWith(prefix))) continue;

    // Signed rather than public: the buckets are private, and the model needs to fetch
    // the image itself.
    const { data: signed, error: signError } = await storage.storage
      .from(PROCESSED_BUCKET)
      .createSignedUrl(item.processedImageKey!, 600);
    if (signError || !signed) throw new Error(`${item.name}: ${signError?.message}`);

    let direction = "unknown";
    if (FORCE) {
      direction = "right"; // named explicitly, so treat it as needing the flip
    } else {
      try {
        direction = await readDirection(version, signed.signedUrl);
      } catch (error) {
        console.log(`  ?? ${item.name} — ${(error as Error).message}`);
      }
    }
    if (!["left", "right", "front"].includes(direction)) direction = "unknown";
    counts[direction] += 1;

    const needsFlip = direction === "right";
    console.log(
      `  ${needsFlip ? "FLIP" : "keep"}  ${direction.padEnd(7)} ${item.name.slice(0, 46)}`,
    );
    if (!needsFlip) continue;
    flipped.push(item.name);
    if (!APPLY) continue;

    const { data, error } = await storage.storage
      .from(PROCESSED_BUCKET)
      .download(item.processedImageKey!);
    if (error) throw new Error(`${item.name}: ${error.message}`);

    // A horizontal flip preserves width and height, so the measured renderWidth and
    // renderHeight stay correct and nothing downstream needs recomputing. It is also
    // its own inverse, which makes this safe to re-run.
    const mirrored = await sharp(Buffer.from(await data.arrayBuffer()))
      .flop()
      .png()
      .toBuffer();

    const up = await storage.storage
      .from(PROCESSED_BUCKET)
      .upload(item.processedImageKey!, mirrored, { contentType: "image/png", upsert: true });
    if (up.error) throw new Error(`${item.name}: ${up.error.message}`);

    if (item.thumbnailKey) {
      const thumb = await storage.storage.from(PROCESSED_BUCKET).download(item.thumbnailKey);
      if (!thumb.error && thumb.data) {
        const mirroredThumb = await sharp(Buffer.from(await thumb.data.arrayBuffer()))
          .flop()
          .png()
          .toBuffer();
        await storage.storage
          .from(PROCESSED_BUCKET)
          .upload(item.thumbnailKey, mirroredThumb, {
            contentType: "image/png",
            upsert: true,
          });
      }
    }
  }

  console.log(
    `\n${items.length} items · left ${counts.left} · right ${counts.right} · ` +
      `front ${counts.front} · unknown ${counts.unknown}`,
  );
  console.log(
    APPLY
      ? `flipped ${flipped.length}`
      : `${flipped.length} would be flipped — re-run with --apply`,
  );
  await db.$disconnect();
}

main();
