/**
 * Fill in estimated prices for items that have none.
 *
 *   npx tsx scripts/estimate-prices.ts            # show what it would set
 *   npx tsx scripts/estimate-prices.ts --apply    # write them
 *   npx tsx scripts/estimate-prices.ts --apply --clear   # remove estimates again
 *
 * **These are guesses.** Cost-per-wear is a headline feature (spec §3), so a guessed
 * price becomes a guessed CPW that is indistinguishable from a real one later. Every
 * estimate is therefore flagged `priceEstimated` in the item's attributes, which makes
 * them listable, correctable and removable as a group.
 *
 * Note that editing an item in the app rebuilds its attributes from the form and so
 * drops the flag. That is the right outcome — editing is when a real price gets typed —
 * but it does mean an unrelated edit silently promotes an estimate to looking real.
 *
 * An item that already has a price is never touched.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Prisma } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const CLEAR = process.argv.includes("--clear");

/**
 * Brand multipliers against a mid-market baseline (Mango ≈ 1.0).
 *
 * Calibrated against the three prices already in the catalog — an Abercrombie sweater at
 * $45, Banana Republic at $40, Mango at $40 — which sit near sale price rather than full
 * retail. Estimating at list price would have overstated the whole closet by roughly a
 * third and quietly inflated every cost-per-wear.
 */
const BRAND_TIER: Record<string, number> = {
  shein: 0.35,
  "port authority": 0.55,
  bershka: 0.6,
  "h&m": 0.6,
  "old navy": 0.6,
  "american eagle": 0.8,
  gap: 0.85,
  zara: 0.95,
  mango: 1.0,
  "abercrombie & fitch": 1.1,
  "ann taylor": 1.1,
  kasper: 1.1,
  "banana republic": 1.2,
  heartloom: 1.2,
  foxcroft: 1.3,
  // Traditional Austrian/Bavarian outfitter — suede trachten pieces are not high-street.
  "berwin & wolff": 2.6,
};

/** Unbranded pieces are assumed high-street rather than designer. */
const DEFAULT_TIER = 0.8;

/** Baseline price in dollars for each garment type, at tier 1.0. */
const GARMENT_BASE: Record<string, number> = {
  "t-shirt": 15,
  top: 20,
  shirt: 30,
  blouse: 32,
  hoodie: 32,
  sweater: 38,
  sweaters: 38,
  cardigan: 38,
  vest: 40,
  overshirt: 42,
  jacket: 65,
  blazer: 70,
};

const CATEGORY_FALLBACK: Record<string, number> = { TOP: 28, OUTERWEAR: 55 };

/** Fabric moves price more than almost anything else at the same brand. */
const MATERIAL_FACTOR: Array<[string, number]> = [
  ["suede", 2.2],
  ["leather", 2.2],
  ["silk", 1.5],
  ["tweed", 1.3],
  ["wool", 1.15],
  ["linen", 1.1],
  ["satin", 1.05],
  ["corduroy", 1.05],
];

function estimateDollars(item: {
  brand: string | null;
  category: string;
  subcategory: string | null;
  attributes: unknown;
}) {
  const tier = BRAND_TIER[item.brand?.trim().toLowerCase() ?? ""] ?? DEFAULT_TIER;
  const base =
    GARMENT_BASE[item.subcategory?.trim().toLowerCase() ?? ""] ??
    CATEGORY_FALLBACK[item.category] ??
    30;

  const material = String(
    ((item.attributes ?? {}) as Record<string, unknown>).material ?? "",
  ).toLowerCase();
  const factor = MATERIAL_FACTOR.find(([word]) => material.includes(word))?.[1] ?? 1;

  // Round to the nearest $5 — false precision would imply a confidence these don't have.
  return Math.max(5, Math.round((base * tier * factor) / 5) * 5);
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set — see SETUP.md.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  if (CLEAR) {
    const estimated = await db.item.findMany({
      where: { attributes: { path: ["priceEstimated"], equals: true } },
      select: { id: true, name: true, attributes: true },
    });
    console.log(`${estimated.length} estimated price(s) to clear${APPLY ? "" : " (dry run)"}\n`);

    for (const item of estimated) {
      console.log(`  ${item.name}`);
      if (!APPLY) continue;
      const rest = { ...(item.attributes as Prisma.JsonObject) };
      delete rest.priceEstimated;
      await db.item.update({
        where: { id: item.id },
        data: { priceCents: null, attributes: rest as Prisma.InputJsonObject },
      });
    }
    await db.$disconnect();
    return;
  }

  const items = await db.item.findMany({
    where: { priceCents: null },
    orderBy: [{ brand: "asc" }, { name: "asc" }],
    select: {
      id: true,
      name: true,
      brand: true,
      category: true,
      subcategory: true,
      attributes: true,
    },
  });

  console.log(`${items.length} item(s) without a price${APPLY ? "" : " (dry run)"}\n`);

  let totalCents = 0;
  for (const item of items) {
    const dollars = estimateDollars(item);
    totalCents += dollars * 100;

    console.log(
      `  $${String(dollars).padStart(3)}  ${(item.brand ?? "unbranded").padEnd(20)} ${item.name}`,
    );

    if (!APPLY) continue;
    await db.item.update({
      where: { id: item.id },
      data: {
        priceCents: dollars * 100,
        attributes: {
          ...((item.attributes ?? {}) as Prisma.JsonObject),
          priceEstimated: true,
        } as Prisma.InputJsonObject,
      },
    });
  }

  console.log(
    `\n${APPLY ? "Set" : "Would set"} ${items.length} price(s), $${(totalCents / 100).toFixed(0)} total.`,
  );
  console.log("Every one is flagged `priceEstimated` — correct any that look wrong in the app.");

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
