/**
 * Run the image pipeline over catalog items: background removal, then normalization
 * onto the shared canvas.
 *
 *   npx tsx scripts/process-images.ts --limit 5            # report only
 *   npx tsx scripts/process-images.ts --limit 5 --apply    # process and store
 *   npx tsx scripts/process-images.ts --apply              # everything still pending
 *   npx tsx scripts/process-images.ts --apply --redo       # re-run items already done
 *
 * Originals are never touched. Results are written alongside them, and an item whose
 * processing fails keeps showing its original photo.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Category } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";

import {
  CANVAS_SIZE,
  THUMBNAIL_SIZE,
  fitToCategory,
  placeOnCanvas,
} from "../lib/images/normalize";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const REDO = process.argv.includes("--redo");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i === -1 ? undefined : Number(process.argv[i + 1]);
})();

/** Substring match on item name, for trialling specific hard cases before a full run. */
const MATCH = (() => {
  const i = process.argv.indexOf("--match");
  return i === -1 ? undefined : process.argv[i + 1];
})();

const ORIGINALS = "closet-originals";
const PROCESSED = "closet-processed";

/**
 * Place a cut-out garment on the shared canvas.
 *
 * Trim first: the segmenter returns a full-frame image that is mostly transparent, so
 * without trimming to the garment's true bounds every item would be scaled by how much
 * empty space happened to surround it rather than by its own size.
 */
async function normalize(cutout: Buffer, category: Category) {
  const trimmed = await sharp(cutout).trim({ threshold: 10 }).png().toBuffer();
  const meta = await sharp(trimmed).metadata();

  if (!meta.width || !meta.height) throw new Error("Could not read trimmed dimensions.");

  const fitted = fitToCategory({ width: meta.width, height: meta.height }, category);
  const { left, top } = placeOnCanvas(fitted, category);

  const resized = await sharp(trimmed)
    .resize(fitted.width, fitted.height, { fit: "fill" })
    .png()
    .toBuffer();

  const canvas = sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  }).composite([{ input: resized, left, top }]);

  const full = await canvas.clone().webp({ quality: 90, alphaQuality: 100 }).toBuffer();
  const thumb = await canvas
    .clone()
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
    .webp({ quality: 82, alphaQuality: 100 })
    .toBuffer();

  return { full, thumb, trimmedSize: { width: meta.width, height: meta.height }, fitted };
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!connectionString || !supabaseUrl || !serviceKey) {
    throw new Error("Supabase env vars are missing — see SETUP.md.");
  }

  // Imported lazily so a dry run doesn't require the Replicate token to be present.
  const { removeBackground } = await import("../lib/images/segment");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const newClient = () =>
    createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  // Same connection-pool degradation as the importer: cycle the client periodically.
  let storage = newClient();
  let opsOnClient = 0;
  const client = () => {
    if (opsOnClient >= 10) {
      storage = newClient();
      opsOnClient = 0;
    }
    opsOnClient += 1;
    return storage;
  };

  const items = await db.item.findMany({
    where: {
      NOT: { originalImageKey: null },
      ...(REDO ? {} : { processingStatus: { in: ["PENDING", "FAILED"] } }),
      ...(MATCH ? { name: { contains: MATCH, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
    select: {
      id: true,
      name: true,
      category: true,
      originalImageKey: true,
      processedImageKey: true,
    },
  });

  console.log(`${items.length} item(s) to process${APPLY ? "" : " (dry run)"}\n`);

  let done = 0;
  let failed = 0;

  for (const item of items) {
    process.stdout.write(`  ${item.name} [${item.category}] … `);

    if (!APPLY) {
      console.log("would process");
      continue;
    }

    try {
      const { data, error } = await client().storage.from(ORIGINALS).download(item.originalImageKey!);
      if (error || !data) throw new Error(`download failed: ${error?.message ?? "no data"}`);

      const original = Buffer.from(await data.arrayBuffer());
      const cutout = await removeBackground(original);
      const { full, thumb, trimmedSize, fitted } = await normalize(cutout, item.category);

      const base = `${item.id}`;
      const fullKey = `${base}.webp`;
      const thumbKey = `${base}-thumb.webp`;

      for (const [key, buffer] of [
        [fullKey, full],
        [thumbKey, thumb],
      ] as const) {
        const up = await client().storage.from(PROCESSED).upload(key, buffer, {
          contentType: "image/webp",
          upsert: true,
        });
        if (up.error) throw new Error(`upload failed: ${up.error.message}`);
      }

      await db.item.update({
        where: { id: item.id },
        data: {
          processedImageKey: fullKey,
          thumbnailKey: thumbKey,
          processingStatus: "DONE",
        },
      });

      console.log(
        `ok  (cutout ${trimmedSize.width}×${trimmedSize.height} → ${fitted.width}×${fitted.height}, ${Math.round(full.length / 1024)}KB)`,
      );
      done += 1;
    } catch (error) {
      console.log(`FAILED — ${error instanceof Error ? error.message : String(error)}`);
      // Recorded so the item keeps showing its original and a later run can retry it.
      await db.item.update({
        where: { id: item.id },
        data: { processingStatus: "FAILED" },
      });
      failed += 1;
    }
  }

  if (APPLY) console.log(`\nProcessed ${done}${failed ? `, ${failed} failed` : ""}.`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
