/**
 * Record the measured size of each garment within its render.
 *
 *   npx tsx scripts/measure-renders.ts            # report
 *   npx tsx scripts/measure-renders.ts --apply    # write
 *
 * The outfit composite needs to know how much of the 1024px canvas is garment and how
 * much is padding. Assuming the per-category maximum was wrong by up to 18% on bottoms,
 * which are width-constrained in their canvas rather than height-constrained, so they
 * rendered too small and sat below the waist instead of meeting the top's hem.
 *
 * Measured by trimming the stored render, so there is no segmentation and no Replicate
 * cost. New items are measured by the pipeline; this is the backfill.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";

import { CANVAS_SIZE, CATEGORY_EXTENT } from "@/lib/images/normalize";
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

  // A fresh client per call — the shared HTTP/2 session dies over a long run.
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
        await new Promise((resolve) => setTimeout(resolve, 1200 * attempt));
      }
    }
    throw lastError;
  }

  const items = await db.item.findMany({
    where: { NOT: { processedImageKey: null } },
    orderBy: { name: "asc" },
    select: { id: true, name: true, category: true, processedImageKey: true },
  });

  console.log(`${items.length} render(s)${APPLY ? "" : " (dry run)"}\n`);
  const drift: number[] = [];

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

    const trimmed = await sharp(source).trim({ threshold: 10 }).toBuffer({ resolveWithObject: true });
    const { width, height } = trimmed.info;

    const assumed = CATEGORY_EXTENT[item.category].height;
    const actual = height / CANVAS_SIZE;
    const error = Math.round((actual / assumed - 1) * 100);
    drift.push(Math.abs(error));

    if (Math.abs(error) >= 5) {
      console.log(`  ${item.name.slice(0, 40).padEnd(42)} ${error > 0 ? "+" : ""}${error}%`);
    }

    if (APPLY) {
      await db.item.update({
        where: { id: item.id },
        data: { renderWidth: width, renderHeight: height },
      });
    }
  }

  const worst = Math.max(...drift);
  const mean = Math.round(drift.reduce((a, b) => a + b, 0) / drift.length);
  console.log(`\n${APPLY ? "Measured" : "Would measure"} ${items.length}. Error vs the per-category assumption: ${mean}% mean, ${worst}% worst.`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
