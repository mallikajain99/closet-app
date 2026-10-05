/**
 * Export a sample closet: original photos plus an import manifest.
 *
 * Originals, not processed cut-outs, on purpose. The point of the folder is that a
 * stranger can run the real pipeline — background removal, hanger removal, render
 * measurement — and see it work on the same photos it was built against. Shipping the
 * finished PNGs would skip the half of the app that is actually interesting.
 *
 *   npx tsx scripts/export-samples.ts --ids a,b,c --out sample-photos
 */
import { execFileSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdirSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import sharp, { type Sharp } from "sharp";
import { config as loadEnv } from "dotenv";

import { ORIGINALS_BUCKET } from "@/lib/images/storage.client";

loadEnv({ path: ".env.local", quiet: true });

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

/**
 * Long edge cap for sample photos.
 *
 * An iPhone original is about 3000×4000 and half a megabyte, which made the folder 14MB
 * — heavy to clone for no benefit, since the pipeline normalises every photo onto a
 * 1024px canvas before anything looks at it. 1600 leaves plenty of headroom above that
 * and still looks like a real photograph rather than a thumbnail.
 */
const MAX_EDGE = 1600;

/**
 * Re-encode a photo as JPEG, capped in size and carrying no metadata.
 *
 * `sharp` first, then macOS `sips` as a fallback: the bundled libheif fails on some of
 * these iPhone HEICs with "bad seek", even though the app's own pipeline processed the
 * very same files. Rather than drop two garments from the sample set over a decoder
 * quirk, hand those to the system converter, which reads them fine.
 */
async function toJpeg(source: Buffer, label: string): Promise<Buffer> {
  const shrink = (image: Sharp) =>
    image
      .resize(MAX_EDGE, MAX_EDGE, { fit: "inside", withoutEnlargement: true })
      .jpeg({ quality: 86 })
      .toBuffer();

  try {
    // `.rotate()` bakes in the EXIF orientation before the tag describing it is lost.
    return await shrink(sharp(source).rotate());
  } catch {
    const scratch = path.join(tmpdir(), `sample-${randomUUID()}`);
    writeFileSync(scratch, source);
    execFileSync("sips", ["-s", "format", "jpeg", scratch, "--out", `${scratch}.jpg`], {
      stdio: "ignore",
    });
    // Back through sharp to strip the metadata sips copies across, and to get the same
    // size cap as the main path — otherwise two photos in the folder are 4000px wide.
    const jpeg = await shrink(sharp(readFileSync(`${scratch}.jpg`)));
    rmSync(scratch, { force: true });
    rmSync(`${scratch}.jpg`, { force: true });
    console.log(`  (converted via sips: ${label})`);
    return jpeg;
  }
}

async function main() {
  const ids = (arg("ids") ?? "").split(",").filter(Boolean);
  const outDir = arg("out") ?? "sample-photos";
  if (ids.length === 0) throw new Error("Pass --ids");

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const items = await db.item.findMany({
    where: { id: { in: ids } },
    select: {
      id: true, name: true, category: true, subcategory: true, colors: true,
      seasons: true, attributes: true, originalImageKey: true,
      tags: { select: { tag: { select: { name: true } } } },
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  mkdirSync(outDir, { recursive: true });
  const manifest = [];

  for (const item of items) {
    const file = `${slug(item.category)}-${slug(item.name)}.jpg`;

    const { data, error } = await storage.storage
      .from(ORIGINALS_BUCKET)
      .download(item.originalImageKey!);
    if (error) throw new Error(`${item.name}: ${error.message}`);

    // Everything lands as JPEG carrying no metadata, for two separate reasons. HEIC is
    // what an iPhone produces but not what every machine can open, and a sample photo
    // that won't preview is a poor first impression. And `sharp` drops EXIF unless told
    // to keep it, which takes the camera model and capture time off the iPhone files —
    // the JPEGs in this closet had already been stripped on upload, but the HEICs
    // hadn't, and a public folder is the wrong place to discover that.
    const source = Buffer.from(await data.arrayBuffer());
    writeFileSync(path.join(outDir, file), await toJpeg(source, item.name));

    const attrs = (item.attributes ?? {}) as Record<string, unknown>;
    manifest.push({
      file,
      name: item.name,
      category: item.category,
      ...(item.subcategory ? { subcategory: item.subcategory } : {}),
      ...(item.colors.length ? { colors: item.colors } : {}),
      ...(item.seasons.length ? { seasons: item.seasons } : {}),
      ...attrs,
      ...(item.tags.length ? { tagNames: item.tags.map((t) => t.tag.name) } : {}),
    });
    console.log(`  ${file}`);
  }

  writeFileSync(path.join(outDir, "manifest.json"), `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`\n${manifest.length} photos → ${outDir}/`);
  await db.$disconnect();
}

main();
