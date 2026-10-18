/**
 * Compose an ad-hoc outfit from item names and write a PNG.
 *
 *   npx tsx scripts/preview-outfit.ts "sky blue scarf" "espresso crewneck" "washed black"
 *
 * `render-outfits.ts` draws outfits that have been *saved*, which is the wrong tool for
 * checking a layout rule: it means inventing an outfit in the app before you can see
 * whether the change worked, and deleting it afterwards. Most layout questions are about
 * a combination nobody has saved — a scarf with a bag, a tie under a cardigan.
 *
 * Geometry is a transcription of components/outfits/outfit-figure.tsx, like
 * render-outfits.ts. If the two disagree, this file is the one that is wrong.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp, { type OverlayOptions } from "sharp";

import { CANVAS_SIZE, CATEGORY_EXTENT } from "@/lib/images/normalize";
import { PROCESSED_BUCKET } from "@/lib/images/storage.client";
import { byPaintOrder, composeOutfit, slotFor } from "@/lib/outfits/slots";

loadEnv({ path: ".env.local", quiet: true });

const WIDTH = 600;
const HEIGHT = WIDTH * 1.5;

async function main() {
  const out = process.argv.includes("--out")
    ? process.argv[process.argv.indexOf("--out") + 1]
    : "/tmp/preview.png";
  const names = process.argv.slice(2).filter((arg, i, all) => {
    if (arg === "--out") return false;
    return all[i - 1] !== "--out";
  });
  if (names.length === 0) throw new Error("Pass one or more item names.");

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const items = [];
  for (const name of names) {
    const found = await db.item.findFirst({
      where: { name: { contains: name, mode: "insensitive" }, processingStatus: "DONE" },
      select: {
        id: true, name: true, category: true, subcategory: true,
        attributes: true, renderWidth: true, renderHeight: true, processedImageKey: true,
      },
    });
    if (!found) {
      console.log(`  not found: ${name}`);
      continue;
    }
    const attrs = (found.attributes ?? {}) as Record<string, unknown>;
    items.push({
      ...found,
      sleeveLength: (attrs.sleeveLength as string | undefined) ?? null,
      silhouette: (attrs.silhouette as string[] | undefined) ?? [],
    });
    console.log(`  ${found.category.padEnd(10)} ${found.name.slice(0, 42)}`);
  }
  if (items.length === 0) throw new Error("Nothing matched.");

  const { placed, frame } = composeOutfit(items);
  const span = Math.max(0.01, frame.bottom - frame.top);
  const positions = new Map(placed.map((p) => [p.item.id, p]));
  const layers: OverlayOptions[] = [];

  for (const item of byPaintOrder(items)) {
    const position = positions.get(item.id);
    if (!position) continue;

    const { data, error } = await storage.storage
      .from(PROCESSED_BUCKET)
      .download(item.processedImageKey!);
    if (error) throw new Error(`${item.name}: ${error.message}`);

    const fill = item.renderHeight
      ? item.renderHeight / CANVAS_SIZE
      : CATEGORY_EXTENT[item.category].height;
    const boxHeight = position.height / fill;
    const centre = position.top + position.height / 2;

    const slot = slotFor(item);
    const side = slot.align === "left" || slot.align === "right";
    const sideWidth = slot.sideWidth ?? 0.38;

    const boxW = Math.max(1, Math.round(side ? WIDTH * sideWidth : WIDTH));
    const boxH = Math.max(1, Math.round((boxHeight / span) * HEIGHT));
    const left = Math.round(
      side
        ? slot.align === "left"
          ? WIDTH * 0.02
          : WIDTH - boxW - WIDTH * 0.02
        : position.offsetX * WIDTH,
    );
    const top = Math.round(
      ((centre - frame.top) / span - boxHeight / span / 2) * HEIGHT,
    );

    layers.push({
      input: await sharp(Buffer.from(await data.arrayBuffer()))
        .resize(boxW, boxH, { fit: "contain", background: { r: 0, g: 0, b: 0, alpha: 0 } })
        .png()
        .toBuffer(),
      left,
      top,
    });
  }

  await sharp({
    create: {
      width: WIDTH, height: HEIGHT, channels: 4,
      background: { r: 255, g: 255, b: 255, alpha: 1 },
    },
  })
    .composite(layers)
    .png()
    .toFile(out);

  console.log(`\n→ ${out}`);
  await db.$disconnect();
}

main();
