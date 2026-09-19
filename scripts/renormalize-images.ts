/**
 * Re-fit already-processed renders to the current normalization geometry.
 *
 *   npx tsx scripts/renormalize-images.ts            # report only
 *   npx tsx scripts/renormalize-images.ts --apply    # rewrite them
 *
 * Whenever `CATEGORY_EXTENT` or `placeOnCanvas` changes, existing renders carry the old
 * geometry. This re-fits them from the stored render — trim to the garment's own bounds,
 * rescale to the category's current box, re-centre — so **no segmentation runs and no
 * Replicate credit is spent**. Re-running the full pipeline to move and resize pixels
 * that are already correct would be absurd.
 *
 * The one thing it cannot do is invent detail. A render stored small and now wanted large
 * has to be upscaled, and past a point that is visibly soft; those items are listed for a
 * real re-run via `process-images --match "<name>" --apply --redo` instead of being
 * quietly blurred.
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
import { PROCESSED_BUCKET } from "@/lib/images/storage.client";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

/** Beyond this the upscale shows, and a fresh cutout is worth the Replicate call. */
const SOFT_UPSCALE_LIMIT = 1.5;

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!connectionString || !supabaseUrl || !serviceKey) {
    throw new Error("Supabase env vars are missing — see SETUP.md.");
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  /**
   * A fresh client per call, and retries on transport failure.
   *
   * Over a long run the Supabase client's HTTP/2 session gets destroyed and every
   * subsequent call on it fails with a bare "fetch failed" — which is exactly what
   * happened here, 30 items in. `lib/images/pipeline.ts` learned this already; the
   * lesson is that the client, not just the request, has to be replaced.
   */
  const newStorage = () =>
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

  const tooSoft: string[] = [];
  let changed = 0;

  for (const item of items) {
    const download = await withRetry(async () => {
      const result = await newStorage().storage
        .from(PROCESSED_BUCKET)
        .download(item.processedImageKey!);
      if (result.error || !result.data) {
        throw new Error(result.error?.message ?? "no data");
      }
      return result.data;
    }).catch((error) => {
      console.log(`  ${item.name} — download failed: ${error}`);
      return null;
    });
    if (!download) continue;

    const trimmed = await sharp(Buffer.from(await download.arrayBuffer()))
      .trim({ threshold: 10 })
      .png()
      .toBuffer({ resolveWithObject: true });

    const current = { width: trimmed.info.width, height: trimmed.info.height };
    // fitToCategory never enlarges, so ask it about the *target* box directly by scaling
    // a notionally large source; otherwise a small stored render can never grow.
    const target = fitToCategory(
      { width: current.width * 10, height: current.height * 10 },
      item.category,
    );
    const scale = target.height / current.height;

    if (Math.abs(scale - 1) < 0.02) continue;
    changed += 1;

    const note = scale > SOFT_UPSCALE_LIMIT ? "  ← re-run for full quality" : "";
    if (scale > SOFT_UPSCALE_LIMIT) tooSoft.push(item.name);
    console.log(`  ${item.name} — ${scale.toFixed(2)}×${note}`);
    if (!APPLY) continue;

    const { left, top } = placeOnCanvas(target, item.category);
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
          input: await sharp(trimmed.data)
            .resize(target.width, target.height, { fit: "fill" })
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

    for (const [key, buffer] of [
      [item.processedImageKey!, full],
      [item.thumbnailKey ?? `${item.id}-thumb.webp`, thumb],
    ] as const) {
      await withRetry(async () => {
        const up = await newStorage()
          .storage.from(PROCESSED_BUCKET)
          .upload(key, buffer, { contentType: "image/webp", upsert: true });
        if (up.error) throw new Error(`upload failed for ${item.name}: ${up.error.message}`);
      });
    }
  }

  console.log(`\n${APPLY ? "Re-fitted" : "Would re-fit"} ${changed} of ${items.length}.`);
  if (tooSoft.length > 0) {
    console.log(`\n${tooSoft.length} upscaled past ${SOFT_UPSCALE_LIMIT}× — re-run these for full quality:`);
    for (const name of tooSoft) console.log(`  npm run process-images -- --match "${name}" --apply --redo`);
  }

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
