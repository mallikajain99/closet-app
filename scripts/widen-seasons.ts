/**
 * Reconsider which seasons each garment is wearable in.
 *
 *   npx tsx scripts/widen-seasons.ts           # report only
 *   npx tsx scripts/widen-seasons.ts --apply   # write
 *
 * Seasons were assigned garment by garment during bulk import, and erred narrow: a
 * cotton tee got spring and summer, a satin slip dress got spring and summer, a pair
 * of jeans got all four. That reads fine on an item page and fails badly in the outfit
 * recommender, which requires *every* piece of an outfit to suit the season — so one
 * over-narrow tee disqualifies a whole look that would be worn under a cardigan in
 * November. Only 31 of 68 outfits survived the autumn filter.
 *
 * The rules below are about how a garment is *used*, not what it is made of:
 *
 *  - **Base layers are all-season.** A tee, tank, camisole or bodysuit is worn on its
 *    own in July and under a sweater in January. This is the change that matters most.
 *  - **Trousers, jeans and skirts are all-season** unless the fabric says otherwise.
 *  - **Knitwear is everything but summer**; heavy outerwear is autumn and winter.
 *  - **Open shoes stay spring and summer**, and boots stay autumn and winter, because
 *    those genuinely don't cross over.
 *  - **Occasion pieces are all-season.** A satin gown is worn whenever the occasion is,
 *    not when the weather is.
 *
 * Only ever widens. Narrowing would silently overrule a judgement the user may have
 * made by hand on the item page, and being too generous here costs a slightly wrong
 * suggestion while being too narrow costs the suggestion entirely.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Season } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

const ALL: Season[] = ["SPRING", "SUMMER", "FALL", "WINTER"];
const NOT_SUMMER: Season[] = ["SPRING", "FALL", "WINTER"];
const COLD: Season[] = ["FALL", "WINTER"];
const WARM: Season[] = ["SPRING", "SUMMER"];

/** Matched in order against subcategory, then name; the first hit wins. */
const RULES: Array<{ match: RegExp; seasons: Season[]; why: string }> = [
  // Genuinely seasonal footwear — these do not cross over, so they are left alone.
  { match: /\b(sandal|sandals|flip flop|espadrille)\b/i, seasons: WARM, why: "open shoe" },
  { match: /\bboot|bootie\b/i, seasons: COLD, why: "boot" },

  // Heavy outerwear.
  { match: /\b(coat|puffer|parka|trench)\b/i, seasons: COLD, why: "heavy outerwear" },

  // Knitwear: not summer, but a cardigan is a spring layer as much as a winter one.
  { match: /\b(sweater|cardigan|knitwear|knit dress|sweater dress|fleece)\b/i, seasons: NOT_SUMMER, why: "knitwear" },

  // Base layers. The important one: worn alone in summer, under things in winter.
  { match: /\b(t-shirt|tee|tank top|camisole|bodysuit|halter top)\b/i, seasons: ALL, why: "base layer" },

  // Bottoms are worn year round; fabric is handled by the linen rule below.
  { match: /\b(jeans|trousers|pants|leggings)\b/i, seasons: ALL, why: "year-round bottom" },

  // Occasion pieces follow the occasion, not the weather.
  { match: /\b(gown|heels|loafers|flats|mules|clutch)\b/i, seasons: ALL, why: "occasion piece" },
];

/** Linen and gauze stay warm-weather whatever the garment, so this runs first. */
const WARM_FABRIC = /\b(linen|gauze|eyelet|seersucker)\b/i;

function seasonsFor(item: {
  name: string;
  subcategory: string | null;
  attributes: unknown;
}): { seasons: Season[]; why: string } | null {
  const material = String(
    ((item.attributes ?? {}) as Record<string, unknown>).material ?? "",
  );
  const text = `${item.subcategory ?? ""} ${item.name}`;

  if (WARM_FABRIC.test(material) || WARM_FABRIC.test(text)) {
    return { seasons: WARM, why: "warm-weather fabric" };
  }

  for (const rule of RULES) {
    if (rule.match.test(text)) return { seasons: rule.seasons, why: rule.why };
  }
  return null;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");
  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const items = await db.item.findMany({
    select: { id: true, name: true, subcategory: true, seasons: true, attributes: true },
    orderBy: { name: "asc" },
  });

  let changed = 0;
  for (const item of items) {
    const verdict = seasonsFor(item);
    if (!verdict) continue;

    // Union, never replacement — see the note above about not overruling the user.
    const merged = ALL.filter(
      (season) => item.seasons.includes(season) || verdict.seasons.includes(season),
    );
    if (merged.length === item.seasons.length) continue;

    changed += 1;
    const added = merged.filter((season) => !item.seasons.includes(season));
    console.log(
      `  +${added.join(",").padEnd(18)} ${`(${verdict.why})`.padEnd(24)} ${item.name}`,
    );
    if (APPLY) {
      await db.item.update({ where: { id: item.id }, data: { seasons: merged } });
    }
  }

  console.log(`\n${APPLY ? "Widened" : "Would widen"} ${changed} of ${items.length} item(s).`);
  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
