/**
 * Straighten garments that were photographed hanging crooked.
 *
 *   npx tsx scripts/straighten-images.ts            # report the lean of each render
 *   npx tsx scripts/straighten-images.ts --apply    # rotate and rewrite them
 *
 * Works on the stored render — rotate, re-trim, re-fit, re-centre — so **no
 * segmentation runs and no Replicate credit is spent**. Rotation resamples once, which
 * is a fair trade for a garment that otherwise leans against every other piece in an
 * outfit composite.
 *
 * New items are straightened by the pipeline itself; this is the backfill.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";

import {
  CANVAS_SIZE,
  THUMBNAIL_SIZE,
  fitToCategory,
  placeOnCanvas,
} from "@/lib/images/normalize";
import { straighten } from "@/lib/images/straighten";
import { PROCESSED_BUCKET } from "@/lib/images/storage.client";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!connectionString || !supabaseUrl || !serviceKey) {
    throw new Error("Supabase env vars are missing — see SETUP.md.");
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  // A fresh client per call: the shared HTTP/2 session gets destroyed over a long run
  // and every later call on it fails. See lib/images/pipeline.ts.
  const storage = () =>
    createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  async function withRetry<T>(operation: () => Promise<T>, attempts = 3): Promise<T> {
    let lastError: unknown;
    for (let attempt = 1; attempt <= attempts; attempt += 1) {
      try {
        return await operation();
      } catch (error) {
        lastError = error;
        if (attempt === attempts) break;
        await new Promise((resolve) => setTimeout(resolve, 1500 * attempt));
      }
    }
    throw lastError;
  }

  const items = await db.item.findMany({
    where: { NOT: { processedImageKey: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true, processedImageKey: true, thumbnailKey: true },
  });

  console.log(`${items.length} render(s)${APPLY ? "" : " (dry run)"}\n`);

  let straightened = 0;

  for (const item of items) {
    const source = await withRetry(async () => {
      const result = await storage().storage
        .from(PROCESSED_BUCKET)
        .download(item.processedImageKey!);
      if (result.error || !result.data) throw new Error(result.error?.message ?? "no data");
      return Buffer.from(await result.data.arrayBuffer());
    }).catch((error) => {
      console.log(`  ${item.name} — download failed: ${error}`);
      return null;
    });
    if (!source) continue;

    const { buffer, degrees } = await straighten(source);
    if (degrees === 0) continue;

    straightened += 1;
    console.log(`  ${item.name} — ${degrees > 0 ? "+" : ""}${degrees.toFixed(1)}°`);
    if (!APPLY) continue;

    // Rotation grows the canvas and moves the garment, so re-fit and re-centre from the
    // rotated pixels rather than assuming the old geometry still holds.
    const trimmed = await sharp(buffer).trim({ threshold: 10 }).png().toBuffer();
    const meta = await sharp(trimmed).metadata();
    if (!meta.width || !meta.height) continue;

    const fitted = fitToCategory({ width: meta.width, height: meta.height }, item.category);
    const { left, top } = placeOnCanvas(fitted, item.category);

    const canvas = await sharp({
      create: {
        width: CANVAS_SIZE,
        height: CANVAS_SIZE,
        channels: 4,
        background: { r: 0, g: 0, b: 0, alpha: 0 },
      },
    })
      .composite([
        {
          input: await sharp(trimmed)
            .resize(fitted.width, fitted.height, { fit: "fill" })
            .png()
            .toBuffer(),
          left,
          top,
        },
      ])
      .png()
      .toBuffer();

    const full = await sharp(canvas).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
    const thumb = await sharp(canvas)
      .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
      .webp({ quality: 82, alphaQuality: 100 })
      .toBuffer();

    for (const [key, data] of [
      [item.processedImageKey!, full],
      [item.thumbnailKey ?? `${item.id}-thumb.webp`, thumb],
    ] as const) {
      await withRetry(async () => {
        const up = await storage()
          .storage.from(PROCESSED_BUCKET)
          .upload(key, data, { contentType: "image/webp", upsert: true });
        if (up.error) throw new Error(`upload failed for ${item.name}: ${up.error.message}`);
      });
    }
  }

  console.log(
    `\n${APPLY ? "Straightened" : "Would straighten"} ${straightened} of ${items.length}.`,
  );
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
