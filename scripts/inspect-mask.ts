/**
 * Dump what the segmentation actually sees for one item.
 *
 *   npx tsx scripts/inspect-mask.ts "Blush ribbed cropped tank"
 *
 * Written because the neckline-bar failure was being reasoned about rather than looked
 * at. The question it answers: does the prompted clothing mask exclude the neck
 * opening — leaving an enclosed hole the island pass could judge — or does it trace the
 * garment's outer silhouette and call the opening clothing?
 */
import { writeFileSync } from "node:fs";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";

import { clothingMask, fillInteriorHoles, readMask, removeBackground } from "@/lib/images/segment";

loadEnv({ path: ".env.local", quiet: true });

const OUT = "/private/tmp/claude-503/-Users-mallika/4517966a-28ca-4fd7-b5b5-2f98d7adbbed/scratchpad/mask";

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error('Pass an item name, e.g. "Blush ribbed cropped tank"');

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const item = await db.item.findFirst({
    where: { name: { contains: name, mode: "insensitive" } },
    select: { name: true, originalImageKey: true },
  });
  if (!item?.originalImageKey) throw new Error(`No original for "${name}"`);
  console.log(`inspecting: ${item.name}`);

  const { data } = await storage.storage.from("closet-originals").download(item.originalImageKey);
  const source = Buffer.from(await (data as Blob).arrayBuffer());

  const [cutout, mask] = await Promise.all([removeBackground(source), clothingMask(source)]);
  const { width, height } = await sharp(cutout).metadata();
  if (!width || !height) throw new Error("no dimensions");

  const { bits } = await readMask(mask, width, height);
  const filled = fillInteriorHoles(bits, width, height);

  let holes = 0;
  for (let i = 0; i < filled.length; i += 1) if (filled[i] && !bits[i]) holes += 1;
  console.log(`  ${width}×${height} · mask covers ${bits.reduce((a, b) => a + b, 0)} px · enclosed holes ${holes} px`);

  await import("node:fs").then((fs) => fs.mkdirSync(OUT, { recursive: true }));
  writeFileSync(`${OUT}/cutout.png`, await sharp(cutout).png().toBuffer());

  // The mask as an image, and the enclosed holes picked out in red over it.
  const rgb = Buffer.alloc(width * height * 3);
  for (let i = 0; i < filled.length; i += 1) {
    const hole = filled[i] && !bits[i];
    const value = bits[i] ? 235 : 30;
    rgb[i * 3] = hole ? 220 : value;
    rgb[i * 3 + 1] = hole ? 40 : value;
    rgb[i * 3 + 2] = hole ? 40 : value;
  }
  writeFileSync(
    `${OUT}/mask.png`,
    await sharp(rgb, { raw: { width, height, channels: 3 } }).png().toBuffer(),
  );
  console.log(`  wrote ${OUT}/cutout.png and mask.png`);
  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
