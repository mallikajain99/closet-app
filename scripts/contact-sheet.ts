/**
 * Render a labelled grid of processed garments, for looking at.
 *
 *   npx tsx scripts/contact-sheet.ts --category SHOE --out /tmp/shoes.jpg
 *   npx tsx scripts/contact-sheet.ts --match socks --out /tmp/socks.jpg
 *
 * The app shows these one page at a time behind a dev server. A judgement about a whole
 * category — are they all facing the same way, did the background removal hold up — is
 * one you can only make with them side by side, and it is the judgement that keeps
 * turning out to need a human rather than a measurement or a model.
 *
 * Each tile carries its short id so a decision can be fed straight back:
 * `orient-shoes.ts --only <ids> --force --apply`.
 */

import { writeFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Category } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp, { type OverlayOptions } from "sharp";

import { PROCESSED_BUCKET } from "@/lib/images/storage.client";

loadEnv({ path: ".env.local", quiet: true });

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const CELL = 240;
const LABEL = 26;
const COLS = 6;

const escape = (value: string) =>
  value.replace(/&/g, "&amp;").replace(/</g, "&lt;").replace(/>/g, "&gt;");

async function main() {
  const category = arg("category") as Category | undefined;
  const match = arg("match");
  const out = arg("out") ?? "/tmp/contact-sheet.jpg";

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
    { auth: { persistSession: false, autoRefreshToken: false } },
  );

  const items = await db.item.findMany({
    where: {
      processingStatus: "DONE",
      processedImageKey: { not: null },
      ...(category ? { category } : {}),
      ...(match
        ? {
            OR: [
              { name: { contains: match, mode: "insensitive" } },
              { subcategory: { contains: match, mode: "insensitive" } },
            ],
          }
        : {}),
    },
    select: { id: true, name: true, processedImageKey: true },
    orderBy: { name: "asc" },
  });

  if (items.length === 0) throw new Error("Nothing matched.");

  const tiles: OverlayOptions[] = [];
  const rows = Math.ceil(items.length / COLS);

  for (const [index, item] of items.entries()) {
    const { data, error } = await storage.storage
      .from(PROCESSED_BUCKET)
      .download(item.processedImageKey!);
    if (error) throw new Error(`${item.name}: ${error.message}`);

    const picture = await sharp(Buffer.from(await data.arrayBuffer()))
      .resize(CELL - 8, CELL - LABEL - 8, {
        fit: "contain",
        background: { r: 255, g: 255, b: 255 },
      })
      .flatten({ background: { r: 255, g: 255, b: 255 } })
      .toBuffer();

    // The number is what makes the sheet usable: "flip 4, 11 and 19" needs 4, 11 and 19
    // to be written on it.
    const caption = Buffer.from(
      `<svg width="${CELL - 8}" height="${LABEL}">
         <rect width="100%" height="100%" fill="#1f1f1f"/>
         <text x="6" y="18" font-family="monospace" font-size="13" fill="#fff">
           ${index + 1}. ${escape(item.id.slice(0, 6))}
         </text>
       </svg>`,
    );

    const column = index % COLS;
    const row = Math.floor(index / COLS);
    tiles.push({ input: picture, left: column * CELL + 4, top: row * CELL + 4 });
    tiles.push({
      input: caption,
      left: column * CELL + 4,
      top: row * CELL + CELL - LABEL - 4,
    });
  }

  await sharp({
    create: {
      width: COLS * CELL,
      height: rows * CELL,
      channels: 3,
      background: { r: 236, g: 234, b: 230 },
    },
  })
    .composite(tiles)
    .jpeg({ quality: 90 })
    .toFile(out);

  writeFileSync(
    `${out}.txt`,
    items.map((item, i) => `${i + 1}\t${item.id.slice(0, 6)}\t${item.name}`).join("\n"),
  );

  for (const [i, item] of items.entries()) {
    console.log(`${String(i + 1).padStart(3)}  ${item.id.slice(0, 6)}  ${item.name}`);
  }
  console.log(`\n${items.length} items → ${out}`);
  await db.$disconnect();
}

main();
