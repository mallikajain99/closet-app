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

import { estimatePriceCents } from "@/lib/items/estimate-price";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const CLEAR = process.argv.includes("--clear");

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
    const cents = estimatePriceCents(item);
    totalCents += cents;

    console.log(
      `  $${String(cents / 100).padStart(3)}  ${(item.brand ?? "unbranded").padEnd(20)} ${item.name}`,
    );

    if (!APPLY) continue;
    await db.item.update({
      where: { id: item.id },
      data: {
        priceCents: cents,
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
