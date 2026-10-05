/**
 * Rank closet items as sample-photo candidates.
 *
 * Two signals, both proxies for "would a stranger find this useful":
 * reuse across outfits (the piece is versatile, so it exercises more of the app) and a
 * clean render (the background removal worked, so the mannequin composite looks right).
 *
 *   npx tsx scripts/rank-samples.ts
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL missing — see SETUP.md.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const items = await db.item.findMany({
    where: { status: "ACTIVE", processingStatus: "DONE" },
    select: {
      id: true, name: true, category: true, subcategory: true,
      renderWidth: true, renderHeight: true, originalImageKey: true,
      _count: { select: { outfitItems: true, wearLogItems: true } },
    },
  });

  const byCategory = new Map<string, typeof items>();
  for (const item of items) {
    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push(item);
  }

  for (const [category, list] of [...byCategory].sort()) {
    list.sort((a, b) => b._count.outfitItems - a._count.outfitItems);
    console.log(`\n### ${category} (${list.length})`);
    for (const i of list.slice(0, 8)) {
      console.log(
        `  ${String(i._count.outfitItems).padStart(2)}o ${String(i._count.wearLogItems).padStart(2)}w ` +
          `${String(i.renderWidth ?? 0).padStart(4)}x${String(i.renderHeight ?? 0).padStart(4)}  ` +
          `${(i.subcategory ?? "-").padEnd(12).slice(0, 12)} ${i.name.slice(0, 44)}`,
      );
    }
  }

  const outfits = await db.outfit.findMany({
    select: {
      name: true,
      versions: {
        orderBy: { createdAt: "desc" }, take: 1,
        select: { items: { select: { item: { select: { name: true, category: true } } } } },
      },
      _count: { select: { wearLogs: true } },
    },
  });

  console.log(`\n### OUTFITS (${outfits.length})`);
  for (const o of outfits.sort((a, b) => b._count.wearLogs - a._count.wearLogs).slice(0, 18)) {
    const pieces = o.versions[0]?.items ?? [];
    console.log(`  ${pieces.length}p ${String(o._count.wearLogs).padStart(2)}w  ${o.name.slice(0, 50)}`);
  }

  await db.$disconnect();
}

main();
