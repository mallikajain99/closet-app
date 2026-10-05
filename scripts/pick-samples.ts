/**
 * Choose a small set of photos that still builds a working closet.
 *
 * Picking the "best" items one category at a time produces a folder that cannot dress
 * a mannequin: nine tops and no shoes. So outfits are chosen first and their pieces
 * follow, which guarantees every sample photo belongs to at least one real outfit.
 *
 * Greedy on wears per *new* item: an outfit that reuses pieces already chosen is close
 * to free, which is what makes a 20-photo folder cover eight outfits instead of three.
 *
 *   npx tsx scripts/pick-samples.ts [--outfits 8]
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const flag = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? [] : (process.argv[i + 1] ?? "").split(",").filter(Boolean);
};

const arg = (name: string) => {
  const i = process.argv.indexOf(`--${name}`);
  return i === -1 ? undefined : process.argv[i + 1];
};

const TARGET = Number(process.argv[process.argv.indexOf("--outfits") + 1]) || 8;
/** Item ids to keep out entirely — e.g. a retailer stock photo we can't republish. */
const EXCLUDE = flag("exclude");
/** Item ids whose outfits must appear, so a feature is guaranteed a demonstration. */
const MUST = flag("must");
/** Item ids to ship as photos even though no saved outfit uses them yet. */
const EXTRA = flag("extra");

/**
 * Prefix match, so a short id from another script's output can be pasted straight in.
 *
 * Exact-set membership silently did nothing when handed the six-character ids that
 * every other script in here prints — the cap was simply absent from the result with no
 * indication that the flag had been ignored.
 */
const listed = (ids: string[], id: string) => ids.some((prefix) => id.startsWith(prefix));

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const outfits = await db.outfit.findMany({
    select: {
      id: true, name: true,
      _count: { select: { wearLogs: true } },
      versions: {
        orderBy: { createdAt: "desc" }, take: 1,
        select: {
          items: {
            select: {
              item: {
                select: {
                  id: true, name: true, category: true, subcategory: true,
                  originalImageKey: true, processingStatus: true, status: true,
                },
              },
            },
          },
        },
      },
    },
  });

  // Only outfits whose every piece is active and successfully processed — a sample set
  // with a broken photo in it teaches the wrong lesson about the pipeline.
  const usable = outfits
    .map((o) => ({ ...o, pieces: (o.versions[0]?.items ?? []).map((i) => i.item) }))
    .filter(
      (o) =>
        o.pieces.length >= 3 &&
        // Shoes required. A top-and-jeans pair with nothing on the feet is a saved
        // partial, not an outfit, and showcasing one invites the reader to conclude the
        // app lost the shoes rather than that nobody chose any.
        o.pieces.some((p) => p.category === "SHOE") &&
        o.pieces.every(
          (p) => p.status === "ACTIVE" && p.processingStatus === "DONE" && p.originalImageKey,
        ) &&
        // An outfit built on an excluded photo can't be rebuilt from the folder, so it
        // would appear in the README as a look nobody can reproduce.
        !o.pieces.some((p) => listed(EXCLUDE, p.id)),
    );

  const chosen: typeof usable = [];
  const items = new Map<string, (typeof usable)[number]["pieces"][number]>();

  // Seeded before the greedy pass: a required piece is required because it shows off a
  // feature, and greedy would skip it precisely because its outfit adds new photos.
  for (const outfit of usable
    .filter((o) => o.pieces.some((p) => listed(MUST, p.id)))
    .sort((a, b) => b.pieces.length - a.pieces.length)) {
    chosen.push(outfit);
    for (const piece of outfit.pieces) items.set(piece.id, piece);
  }

  /**
   * How many chosen outfits one garment may appear in.
   *
   * Reuse is the whole point of the greedy score, and left alone it overshoots: the
   * first unconstrained run picked six outfits sharing one pair of jeans and one pair
   * of mary janes, because each was nearly free. Cheap to assemble, dull to look at,
   * and it makes the app look like it can only dress one way. The cap buys variety at
   * the cost of a few extra photos.
   */
  const MAX_REUSE = Number(arg("max-reuse")) || 4;
  const appearances = new Map<string, number>();
  for (const outfit of chosen) {
    for (const piece of outfit.pieces) {
      appearances.set(piece.id, (appearances.get(piece.id) ?? 0) + 1);
    }
  }

  /**
   * What makes two outfits the same *look*: everything but the shoes.
   *
   * Swapping mary janes for Converse under the same shirt and jeans is a real decision
   * a wearer makes, and the app is right to store both. On a contact sheet it reads as
   * the same photo twice, because the shoes are a hundred pixels at the bottom of a
   * frame dominated by the shirt. So shoes are left out of the identity and one of the
   * pair is dropped.
   */
  const look = (outfit: (typeof usable)[number]) =>
    outfit.pieces
      .filter((p) => p.category !== "SHOE")
      .map((p) => p.id)
      .sort()
      .join("|");

  const looks = new Set(chosen.map(look));

  while (chosen.length < TARGET) {
    let best = null as null | { outfit: (typeof usable)[number]; score: number };
    for (const outfit of usable) {
      if (chosen.includes(outfit)) continue;
      if (looks.has(look(outfit))) continue;
      if (outfit.pieces.some((p) => (appearances.get(p.id) ?? 0) >= MAX_REUSE)) continue;
      const fresh = outfit.pieces.filter((p) => !items.has(p.id)).length;
      // +1 so an outfit that adds nothing new still scores, and wears break ties.
      const score = (outfit._count.wearLogs + 1) / (fresh + 1);
      if (!best || score > best.score) best = { outfit, score };
    }
    if (!best) break;
    chosen.push(best.outfit);
    looks.add(look(best.outfit));
    for (const piece of best.outfit.pieces) {
      items.set(piece.id, piece);
      appearances.set(piece.id, (appearances.get(piece.id) ?? 0) + 1);
    }
  }

  for (const id of EXTRA) {
    const extra = await db.item.findUnique({
      where: { id },
      select: {
        id: true, name: true, category: true, subcategory: true,
        originalImageKey: true, processingStatus: true, status: true,
      },
    });
    if (extra) items.set(extra.id, extra);
  }

  console.log(`${chosen.length} outfits · ${items.size} photos\n`);
  for (const o of chosen) {
    console.log(`  ${o._count.wearLogs}w  ${o.name}`);
    for (const p of o.pieces) console.log(`        ${p.category.padEnd(10)} ${p.name}`);
  }

  const byCategory = new Map<string, number>();
  for (const i of items.values()) byCategory.set(i.category, (byCategory.get(i.category) ?? 0) + 1);
  console.log(`\ncoverage: ${[...byCategory].sort().map(([c, n]) => `${c}=${n}`).join(" ")}`);

  // Both id lists, because the next two steps need different ones: export-samples
  // takes items, render-outfits takes outfits, and the outfit names collide so they
  // cannot be passed by name.
  console.log(`\nIDS=${[...items.keys()].join(",")}`);
  console.log(`OUTFITS=${chosen.map((o) => o.id.slice(0, 6)).join(",")}`);
  await db.$disconnect();
}

main();
