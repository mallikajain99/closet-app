/**
 * Measure how big every garment actually draws on the figure.
 *
 *   npx tsx scripts/fitting.ts                 # per-category spread
 *   npx tsx scripts/fitting.ts --category SHOE # every item in one category
 *
 * The layout table sets a *height* for each category, as a fraction of the figure. What
 * a reader sees, though, is the garment's width as much as its height — and width is not
 * controlled at all. It falls out of the photograph's aspect ratio:
 *
 *     drawn width = drawn height x (renderWidth / renderHeight)
 *
 * So two pairs of shoes given the identical 0.13 of the figure's height can draw to very
 * different widths, purely because one was photographed side-on and the other as a pair
 * at an angle. That is the complaint "some of the shoes are not the same size": they are
 * the same height, which is the wrong thing for them to share.
 *
 * This prints the spread so the choice of axis can be made per category on evidence
 * rather than by eye on one outfit.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Category } from "@prisma/client";
import { config as loadEnv } from "dotenv";

import { CATEGORY_SLOT, layoutFor, slotFor } from "@/lib/outfits/slots";

loadEnv({ path: ".env.local", quiet: true });

const arg = (name: string) => {
  const index = process.argv.indexOf(`--${name}`);
  return index === -1 ? undefined : process.argv[index + 1];
};

const median = (values: number[]) => {
  const sorted = [...values].sort((a, b) => a - b);
  const middle = Math.floor(sorted.length / 2);
  return sorted.length % 2 ? sorted[middle] : (sorted[middle - 1] + sorted[middle]) / 2;
};

async function main() {
  const only = arg("category") as Category | undefined;

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const items = await db.item.findMany({
    where: {
      status: "ACTIVE",
      processingStatus: "DONE",
      renderWidth: { not: null },
      renderHeight: { not: null },
      ...(only ? { category: only } : {}),
    },
    select: {
      id: true, name: true, category: true, subcategory: true,
      renderWidth: true, renderHeight: true, attributes: true,
    },
    orderBy: [{ category: "asc" }, { name: "asc" }],
  });

  type Row = { name: string; id: string; width: number; height: number; aspect: number };
  const byCategory = new Map<string, Row[]>();

  for (const item of items) {
    const attrs = (item.attributes ?? {}) as Record<string, unknown>;
    const subject = {
      category: item.category,
      subcategory: item.subcategory,
      name: item.name,
      sleeveLength: (attrs.sleeveLength as string | undefined) ?? null,
      silhouette: (attrs.silhouette as string[] | undefined) ?? [],
      renderWidth: item.renderWidth,
      renderHeight: item.renderHeight,
    };

    const slot = slotFor(subject);
    const aspect = item.renderWidth! / item.renderHeight!;

    // Mirrors composeOutfit: a width-targeted category back-computes its height from the
    // render's aspect; everything else takes its height from the landmark table.
    const height = slot.widthTarget
      ? slot.widthTarget / aspect
      : layoutFor(subject).height;
    const width = height * aspect;

    if (!byCategory.has(item.category)) byCategory.set(item.category, []);
    byCategory.get(item.category)!.push({
      name: item.name, id: item.id.slice(0, 6), width, height, aspect,
    });
  }

  for (const [category, rows] of [...byCategory].sort()) {
    const widths = rows.map((r) => r.width);
    const heights = rows.map((r) => r.height);
    const sized = CATEGORY_SLOT[category as Category].widthTarget ? "width" : "height";

    console.log(
      `\n### ${category} (${rows.length}) — sized by ${sized}\n` +
        `    width  ${Math.min(...widths).toFixed(3)} – ${Math.max(...widths).toFixed(3)}` +
        `  median ${median(widths).toFixed(3)}  spread ${(Math.max(...widths) / Math.min(...widths)).toFixed(1)}x\n` +
        `    height ${Math.min(...heights).toFixed(3)} – ${Math.max(...heights).toFixed(3)}` +
        `  median ${median(heights).toFixed(3)}  spread ${(Math.max(...heights) / Math.min(...heights)).toFixed(1)}x`,
    );

    if (!only) continue;
    for (const row of [...rows].sort((a, b) => b.width - a.width)) {
      console.log(
        `    w ${row.width.toFixed(3)}  h ${row.height.toFixed(3)}  ` +
          `aspect ${row.aspect.toFixed(2)}  ${row.id}  ${row.name.slice(0, 44)}`,
      );
    }
  }

  await db.$disconnect();
}

main();
