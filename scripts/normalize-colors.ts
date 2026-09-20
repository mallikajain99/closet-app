/**
 * Move "multicolour" out of the colour field and onto a tag.
 *
 *   npx tsx scripts/normalize-colors.ts           # report only
 *   npx tsx scripts/normalize-colors.ts --apply   # write
 *
 * A colour family needs a swatch, and no swatch is honest about a print — the beige
 * "Multicolour" ended up with made it read as one more neutral in the filter row. Being
 * colourful is a property of the garment rather than a colour it is, so it becomes a
 * tag alongside work and gym, and the colour field keeps only colours it can name.
 *
 * An item left with no colours at all is correct rather than lossy: "multicolour" never
 * told us a colour, and the tag now carries everything it did say.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

import { COLORFUL_TAG, meansColorful } from "@/lib/items/colors";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const items = await db.item.findMany({
    select: { id: true, name: true, userId: true, colors: true },
  });
  const affected = items.filter((item) => item.colors.some(meansColorful));

  console.log(`${affected.length} item(s) to retag${APPLY ? "" : " (dry run)"}\n`);

  for (const item of affected) {
    const kept = item.colors.filter((color) => !meansColorful(color));
    console.log(
      `  ${item.colors.join("/").padEnd(32)} → ${(kept.join("/") || "—").padEnd(20)} + #${COLORFUL_TAG}  ${item.name}`,
    );
    if (!APPLY) continue;

    // Reuse an existing spelling rather than minting a second casing of the same tag,
    // the way the item form and the bulk importer both do.
    const existing = await db.tag.findFirst({
      where: { userId: item.userId, name: { equals: COLORFUL_TAG, mode: "insensitive" } },
      select: { id: true },
    });
    const tag =
      existing ??
      (await db.tag.create({
        data: { userId: item.userId, name: COLORFUL_TAG },
        select: { id: true },
      }));

    await db.item.update({
      where: { id: item.id },
      data: {
        colors: kept,
        tags: {
          connectOrCreate: {
            where: { itemId_tagId: { itemId: item.id, tagId: tag.id } },
            create: { tagId: tag.id },
          },
        },
      },
    });
  }

  console.log(
    `\n${APPLY ? "Retagged" : "Would retag"} ${affected.length} item(s).`,
  );
  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
