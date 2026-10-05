/**
 * Render saved outfits to PNGs, off the browser.
 *
 *   npx tsx scripts/render-outfits.ts --names "Blue shirt + washed black jeans,..."
 *   npx tsx scripts/render-outfits.ts --all --out /tmp/outfits
 *
 * The app composes outfits in CSS — absolutely positioned layers inside a 2:3 box — so
 * the only way to see one used to be to open it. That is fine for using the app and
 * useless for a README, a review pass, or checking that a layering change did what it
 * claimed across forty outfits at once.
 *
 * The geometry here is deliberately a transcription of `components/outfits/
 * outfit-figure.tsx` rather than a second opinion about it: same `composeOutfit` call,
 * same `fill` correction, same `object-contain` behaviour expressed as sharp's
 * `fit: "contain"`. If the two ever disagree, this file is the one that is wrong.
 */

import { mkdirSync } from "node:fs";
import path from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp, { type OverlayOptions } from "sharp";

import { CANVAS_SIZE, CATEGORY_EXTENT } from "@/lib/images/normalize";
import { PROCESSED_BUCKET } from "@/lib/images/storage.client";
import { CATEGORY_SLOT, byPaintOrder, composeOutfit } from "@/lib/outfits/slots";

loadEnv({ path: ".env.local", quiet: true });

/** 2:3, as in the component: a standing figure is far taller than it is wide. */
const WIDTH = 600;
const HEIGHT = WIDTH * 1.5;

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const slug = (text: string) =>
  text.toLowerCase().replace(/[^a-z0-9]+/g, "-").replace(/^-|-$/g, "");

async function main() {
  const outDir = arg("out") ?? "/tmp/outfits";
  const wanted = (arg("names") ?? "").split(",").map((n) => n.trim()).filter(Boolean);

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  // Ids as well as names, because the names collide: they are generated from two
  // garments, so picking an outfit by name can silently fetch a different one.
  const ids = (arg("ids") ?? "").split(",").map((i) => i.trim()).filter(Boolean);

  const outfits = await db.outfit.findMany({
    // Prefixes are filtered after the fetch: `id` is a uuid column, and Prisma offers
    // no `startsWith` on those.
    where: ids.length ? {} : wanted.length ? { name: { in: wanted } } : {},
    select: {
      id: true, name: true,
      versions: {
        orderBy: { createdAt: "desc" }, take: 1,
        select: {
          items: {
            select: {
              item: {
                select: {
                  id: true, name: true, category: true, subcategory: true,
                  attributes: true, renderWidth: true, renderHeight: true,
                  processedImageKey: true,
                },
              },
            },
          },
        },
      },
    },
  });

  mkdirSync(outDir, { recursive: true });
  const cache = new Map<string, Buffer>();

  const chosen = ids.length
    ? outfits.filter((o) => ids.some((prefix) => o.id.startsWith(prefix)))
    : outfits;

  for (const outfit of chosen) {
    const items = (outfit.versions[0]?.items ?? [])
      .map(({ item }) => {
        const attrs = (item.attributes ?? {}) as Record<string, unknown>;
        return {
          ...item,
          sleeveLength: (attrs.sleeveLength as string | undefined) ?? null,
          silhouette: (attrs.silhouette as string[] | undefined) ?? [],
        };
      })
      .filter((item) => item.processedImageKey);

    if (items.length === 0) continue;

    const { placed, frame } = composeOutfit(items);
    const span = Math.max(0.01, frame.bottom - frame.top);
    const positions = new Map(placed.map((p) => [p.item.id, p]));

    const layers: OverlayOptions[] = [];

    // Back to front: the same order the component paints in, so a shirt worn over a
    // dress covers the dress rather than hiding behind it.
    for (const item of byPaintOrder(items)) {
      const position = positions.get(item.id);
      if (!position) continue;

      if (!cache.has(item.processedImageKey!)) {
        const { data, error } = await storage.storage
          .from(PROCESSED_BUCKET)
          .download(item.processedImageKey!);
        if (error) throw new Error(`${item.name}: ${error.message}`);
        cache.set(item.processedImageKey!, Buffer.from(await data.arrayBuffer()));
      }

      // The stored render is a square canvas the garment only partly fills, so the box
      // is enlarged by the fill fraction or the garment lands smaller than its target.
      const fill = item.renderHeight
        ? item.renderHeight / CANVAS_SIZE
        : CATEGORY_EXTENT[item.category].height;
      const boxHeight = position.height / fill;
      const centre = position.top + position.height / 2;

      const topFraction = (centre - frame.top) / span - boxHeight / span / 2;
      const heightFraction = boxHeight / span;

      const side = CATEGORY_SLOT[item.category].align === "side";
      const boxW = Math.max(1, Math.round(side ? WIDTH * 0.38 : WIDTH));
      const boxH = Math.max(1, Math.round(heightFraction * HEIGHT));
      const left = Math.round(
        side ? WIDTH - boxW - WIDTH * 0.02 : position.offsetX * WIDTH,
      );
      const top = Math.round(topFraction * HEIGHT);

      const resized = await sharp(cache.get(item.processedImageKey!)!)
        .resize(boxW, boxH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer();

      layers.push({ input: resized, left, top });
    }

    // Id suffix because outfit names are generated from two garments and genuinely
    // collide — "Brown belt + black top" names more than one outfit in this closet, and
    // on a bare-name filename the second silently overwrote the first.
    const file = path.join(outDir, `${slug(outfit.name)}-${outfit.id.slice(0, 6)}.png`);
    await sharp({
      create: {
        width: WIDTH, height: HEIGHT, channels: 4,
        background: { r: 255, g: 255, b: 255, alpha: 1 },
      },
    })
      .composite(layers)
      .png()
      .toFile(file);

    console.log(`  ${items.length}p  ${outfit.name}`);
  }

  console.log(`\n${chosen.length} outfits → ${outDir}/`);
  await db.$disconnect();
}

main();
