/**
 * Phase 2.5 calibration tool: composite real garments over the mannequin figure.
 *
 *   npx tsx scripts/outfit-preview.ts --top "Moss green" --outer "Brown windowpane"
 *   npx tsx scripts/outfit-preview.ts --sample 3     # three random outfits, side by side
 *   npx tsx scripts/outfit-preview.ts --top "Brown windowpane" \
 *     --figures ~/Desktop/mannequin-candidates    # one outfit across every candidate
 *
 * This is how decision 5 gets made and how the per-category anchors in
 * lib/images/normalize.ts get tuned — by looking at real clothes on the figure rather
 * than reasoning about fractions. It writes a PNG and prints where.
 *
 * The composite itself is almost nothing, and that is the point: every garment is
 * already normalized onto the same 1024px canvas with a per-category vertical anchor, so
 * stacking those canvases in slot order puts each piece at roughly the right height with
 * no per-item nudging. If an outfit reads wrong, the anchor table is what to change.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Category } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp, { type OverlayOptions } from "sharp";
import { readdirSync, writeFileSync } from "node:fs";
import { basename, resolve } from "node:path";

loadEnv({ path: ".env.local", quiet: true });

const CANVAS = 1024;
const DEFAULT_FIGURE = resolve("public/mannequin/placeholder.svg");

/**
 * Where each category sits on the figure, as fractions of **the figure's own height** —
 * not of the canvas.
 *
 * Two separate points here. First, this table has to exist at all: `CATEGORY_EXTENT` in
 * lib/images/normalize.ts is tuned so a garment fills its grid tile, giving outerwear
 * 78% of the canvas height, whereas on a body a blazer covers shoulders to hips, about
 * half the figure. Reusing the grid numbers renders a jacket that swallows the mannequin.
 *
 * Second, the fractions are figure-relative because candidate figures fill the frame
 * differently — the placeholder spans 0.84 of the canvas, a stock mannequin 0.95 and
 * sits lower. Measured against the canvas, the same numbers put garments high on a
 * taller figure. Measured against the figure, any candidate drops in without retuning,
 * which is the whole point of being able to compare them.
 *
 * `height` is the fraction of the figure's height the garment occupies; `centre` is how
 * far down the figure its middle sits, 0 at the crown and 1 at the soles.
 */
const COMPOSITE_GEOMETRY: Partial<Record<Category, { height: number; centre: number }>> = {
  HAT: { height: 0.095, centre: 0.044 },
  TOP: { height: 0.44, centre: 0.388 },
  OUTERWEAR: { height: 0.51, centre: 0.412 },
  DRESS: { height: 0.69, centre: 0.495 },
  BOTTOM: { height: 0.40, centre: 0.767 },
  SHOE: { height: 0.083, centre: 0.965 },
  BAG: { height: 0.19, centre: 0.59 },
  JEWELRY: { height: 0.071, centre: 0.186 },
  ACCESSORY: { height: 0.119, centre: 0.234 },
};

/**
 * The figure's vertical extent within the canvas, from its alpha channel.
 *
 * Everything else is positioned against this, so a candidate that sits low or fills more
 * of the frame doesn't shift every garment on it.
 */
async function measureFigure(figure: Buffer) {
  const { data, info } = await sharp(figure)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  let top = -1;
  let bottom = -1;
  for (let y = 0; y < info.height; y += 1) {
    let present = false;
    for (let x = 0; x < info.width; x += 1) {
      if (data[(y * info.width + x) * info.channels] >= 128) { present = true; break; }
    }
    if (!present) continue;
    if (top < 0) top = y;
    bottom = y;
  }

  if (top < 0) throw new Error("Figure image is fully transparent.");
  return { top, span: Math.max(1, bottom - top) };
}

/** Back to front. A jacket sits over a top; a top sits over a waistband. */
const Z_ORDER: Category[] = [
  "BOTTOM",
  "DRESS",
  "TOP",
  "OUTERWEAR",
  "SHOE",
  "HAT",
  "BAG",
  "JEWELRY",
  "ACCESSORY",
];

function arg(name: string) {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
}

type Garment = { name: string; category: Category; processedImageKey: string };

async function composite(
  garments: Garment[],
  download: (key: string) => Promise<Buffer>,
  figurePath: string = DEFAULT_FIGURE,
) {
  const ordered = [...garments].sort(
    (a, b) => Z_ORDER.indexOf(a.category) - Z_ORDER.indexOf(b.category),
  );

  // `fit: contain` rather than fill, so a candidate figure of any aspect ratio keeps its
  // proportions — a stretched mannequin would invalidate the comparison it exists for.
  const figure = await sharp(figurePath, { density: 200 })
    .resize(CANVAS, CANVAS, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  const body = await measureFigure(figure);

  // `--bare` drops the figure but keeps its geometry, which is the point: the body is a
  // single layer at the very back, and whether it is drawn is independent of whether
  // garments are positioned as if worn. Decision 4 is therefore reversible at any time.
  const showFigure = !process.argv.includes("--bare");

  const layers: OverlayOptions[] = [];
  for (const garment of ordered) {
    const buffer = await download(garment.processedImageKey);
    const geometry = COMPOSITE_GEOMETRY[garment.category];
    if (!geometry) continue;

    // The stored render is the garment padded out to the full canvas, so trim back to
    // the garment's own bounds before rescaling — otherwise the padding is what gets
    // scaled and the garment lands somewhere arbitrary.
    const trimmed = await sharp(buffer).trim({ threshold: 10 }).png().toBuffer();
    const meta = await sharp(trimmed).metadata();
    if (!meta.width || !meta.height) continue;

    const targetHeight = Math.round(body.span * geometry.height);
    const scale = targetHeight / meta.height;
    const width = Math.max(1, Math.round(meta.width * scale));

    const resized = await sharp(trimmed)
      .resize(width, targetHeight, { fit: "fill" })
      .png()
      .toBuffer();

    layers.push({
      input: resized,
      left: Math.round((CANVAS - width) / 2),
      top: Math.round(body.top + body.span * geometry.centre - targetHeight / 2),
    });
  }

  return sharp({
    create: {
      width: CANVAS,
      height: CANVAS,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(showFigure ? [{ input: figure, left: 0, top: 0 }, ...layers] : layers)
    .png()
    .toBuffer();
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!connectionString || !supabaseUrl || !serviceKey) {
    throw new Error("Supabase env vars are missing — see SETUP.md.");
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const storage = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const download = async (key: string) => {
    const { data, error } = await storage.storage.from("closet-processed").download(key);
    if (error || !data) throw new Error(`Could not download ${key}: ${error?.message}`);
    return Buffer.from(await data.arrayBuffer());
  };

  const byName = async (needle: string) => {
    const item = await db.item.findFirst({
      where: { name: { contains: needle, mode: "insensitive" }, processedImageKey: { not: null } },
      select: { name: true, category: true, processedImageKey: true },
    });
    if (!item) throw new Error(`No processed item matching "${needle}".`);
    return item as Garment;
  };

  const sample = Number(arg("sample") ?? 0);
  const outfits: Garment[][] = [];

  if (sample > 0) {
    // One top plus one piece of outerwear per outfit, which is all the catalog holds.
    const [tops, outers] = await Promise.all(
      (["TOP", "OUTERWEAR"] as const).map((category) =>
        db.item.findMany({
          where: { category, processedImageKey: { not: null } },
          select: { name: true, category: true, processedImageKey: true },
        }),
      ),
    );

    for (let i = 0; i < sample; i += 1) {
      const top = tops[Math.floor(Math.random() * tops.length)] as Garment;
      const outer = outers[Math.floor(Math.random() * outers.length)] as Garment;
      outfits.push([top, outer]);
    }
  } else {
    const picked = await Promise.all(
      (["top", "outer", "bottom", "shoe", "hat"] as const)
        .map((slot) => arg(slot))
        .filter((value): value is string => Boolean(value))
        .map(byName),
    );
    if (picked.length === 0) throw new Error("Pass --top/--outer/… or --sample N.");
    outfits.push(picked);
  }

  /**
   * Candidate comparison: the same outfit over every figure in a directory, side by side.
   *
   * This is how decision 5 gets judged. A mannequin thumbnail tells you nothing about
   * whether *your* blazer sits on it correctly — proportions only reveal themselves under
   * real clothes.
   */
  const figuresDir = arg("figures");
  const figures = figuresDir
    ? readdirSync(figuresDir)
        .filter((file) => /\.(png|svg|jpe?g|webp)$/i.test(file))
        .sort()
        .map((file) => resolve(figuresDir, file))
    : [DEFAULT_FIGURE];

  if (figuresDir) {
    if (figures.length === 0) throw new Error(`No image files in ${figuresDir}.`);
    console.log(`Comparing ${figures.length} figure(s) against outfit 1:\n`);
    figures.forEach((file, i) => console.log(`  ${i + 1}. ${basename(file)}`));
    console.log("");
  }

  const rendered = figuresDir
    ? await Promise.all(figures.map((figure) => composite(outfits[0], download, figure)))
    : await Promise.all(outfits.map((garments) => composite(garments, download)));

  const sheet = await sharp({
    create: {
      width: CANVAS * rendered.length,
      height: CANVAS,
      channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(rendered.map((input, i) => ({ input, left: i * CANVAS, top: 0 })))
    .png()
    .toBuffer();

  const out = arg("out") ?? "/tmp/outfit-preview.png";
  writeFileSync(out, sheet);

  outfits.forEach((garments, i) => {
    console.log(`Outfit ${i + 1}: ${garments.map((g) => `${g.name} [${g.category}]`).join(" + ")}`);
  });
  console.log(`\nWrote ${out}`);

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
