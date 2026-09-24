import type { Category, Season } from "@prisma/client";

/**
 * Suggest what to wear next.
 *
 * The premise, from the user: she is at class every day, so essentially every day is
 * one of three things — **casual, gym, or work**. Recommendations are therefore grouped
 * by those three rather than offered as one undifferentiated ranking; "what should I
 * wear" is not a question you can answer without knowing which of the three it is.
 *
 * Ranking is rotation-first. The closet has far more outfits than the week has days, so
 * the useful suggestion is not "the best outfit" — it is the good outfit that has gone
 * unworn longest. That also happens to be what makes cost-per-wear improve, which is
 * the number the app exists to report.
 */

export const CONTEXTS = ["casual", "work", "gym"] as const;
export type Context = (typeof CONTEXTS)[number];

export const CONTEXT_LABELS: Record<Context, string> = {
  casual: "Casual",
  work: "Work",
  gym: "Gym",
};

export type RecommendableItem = {
  name: string;
  category: Category;
  subcategory: string | null;
  brand: string | null;
  colors: string[];
  seasons: Season[];
  formality: string | null;
  material: string | null;
  sleeveLength: string | null;
};

/**
 * How much repeating a *kind* of garment damps an outfit's score, by category.
 *
 * From the user: wearing a cardigan on Monday makes a different cardigan on Tuesday
 * feel repetitive, but the same jeans — or the same shoes — several days running is
 * just what those are for. The difference is not the garment's identity, it is which
 * pieces carry an outfit's character.
 *
 * Applied per *subcategory*, not per item, which is the whole point: a different
 * cardigan is still a cardigan.
 *
 * A *fraction of the score*, not a fixed number of points. Subtracting points was the
 * first attempt and it did not work: a never-worn outfit scores 120, so a 55-point
 * cardigan penalty still left it ahead of everything worn in the last month, and the
 * user saw two cardigan outfits suggested the day after wearing one. A multiplier
 * bites the same amount whatever the base score is.
 */
const REPEAT_DAMPING: Record<Category, number> = {
  OUTERWEAR: 0.8,
  DRESS: 0.75,
  TOP: 0.55,
  HAT: 0.3,
  BAG: 0.15,
  // Near-free, and level with each other at the user's own request: she rewears one
  // pair of shoes across most outfits, the way she rewears one pair of jeans.
  SHOE: 0.1,
  BOTTOM: 0.1,
  JEWELRY: 0.05,
  ACCESSORY: 0.05,
};

/** How far back a kind still counts as recently worn. */
const REPEAT_WINDOW_DAYS = 4;

/** A kind of garment worn recently, and how many days ago. */
export type RecentKind = { category: Category; subcategory: string | null; daysAgo: number };

export type RecommendableOutfit = {
  id: string;
  name: string;
  tags: string[];
  /** Most recent wear that has actually happened; planned wears do not count. */
  lastWornOn: Date | null;
  wearCount: number;
  /** Already on the calendar in the week being planned — don't suggest it twice. */
  spokenFor: boolean;
  items: RecommendableItem[];
};

export type Recommendation = {
  outfit: RecommendableOutfit;
  score: number;
  /** Why it was suggested, shown to the user — a ranking nobody can read is noise. */
  reason: string;
};

const DAY = 86_400_000;

/**
 * Formality values that read as workwear, and as off-duty.
 *
 * "dressy" used to count as work and does not: it is the evening end of the scale, and
 * including it swept going-out clothes into the work column. Work is "smart" — the
 * blazer end of tidy, not the satin end.
 */
const WORK_FORMALITY = new Set(["smart"]);
const CASUAL_FORMALITY = new Set(["casual", "simple"]);

/**
 * Tags naming an occasion that isn't one of the three everyday contexts.
 *
 * An outfit tagged "going out" is a statement about what it is for, and guessing at it
 * from formality anyway is how a going-out outfit ended up under Work. These tags stop
 * the inference: without an explicit casual/work/gym tag, such an outfit belongs to
 * none of them.
 *
 * Only occasions, deliberately — a descriptive tag like "warm" or "colorful" says
 * nothing about when a thing is worn and must not exclude it from everything.
 */
const OCCASION_TAGS = new Set([
  "going out",
  "night out",
  "date",
  "date night",
  "wedding",
  "party",
  "cocktail",
  "formal",
  "interview",
  "beach",
  "holiday",
  "vacation",
]);

/**
 * Activewear has no formality of its own — "casual" covers both a linen shirt and a
 * pair of bike shorts — so it is recognised by what the garment actually is.
 */
const GYM_SUBCATEGORIES = new Set([
  "leggings",
  "bike shorts",
  "sports bra",
  "sneakers",
  "shorts",
  "tank top",
]);
const GYM_BRANDS = new Set(["nike", "lululemon", "adidas", "under armour"]);

const lower = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

/** Every word the user could plausibly search an outfit by. */
function haystack(outfit: RecommendableOutfit): string {
  return [
    outfit.name,
    ...outfit.tags,
    ...outfit.items.flatMap((item) => [
      item.name,
      item.subcategory,
      item.brand,
      item.formality,
      item.material,
      ...item.colors,
    ]),
  ]
    .filter(Boolean)
    .join(" ")
    .toLowerCase();
}

/**
 * Whether an outfit belongs to a context.
 *
 * A tag wins outright where one exists — the user saying "work" about an outfit beats
 * anything inferred from its pieces. Only untagged outfits fall through to formality,
 * which is a guess and treated as one.
 */
export function suitsContext(outfit: RecommendableOutfit, context: Context): boolean {
  const tags = outfit.tags.map(lower);
  if (tags.includes(context)) return true;
  // A tag naming a *different* context is a statement that it isn't this one.
  if (CONTEXTS.some((other) => other !== context && tags.includes(other))) return false;
  // Nor is it an everyday outfit at all if it is tagged for an occasion and nothing
  // else. Inferring past that put a "going out" outfit in the work column.
  if (tags.some((tag) => OCCASION_TAGS.has(tag))) return false;

  const formalities = outfit.items.map((item) => lower(item.formality)).filter(Boolean);

  if (context === "gym") {
    return outfit.items.some(
      (item) =>
        GYM_SUBCATEGORIES.has(lower(item.subcategory)) &&
        GYM_BRANDS.has(lower(item.brand)),
    );
  }

  if (formalities.length === 0) return context === "casual";

  return context === "work"
    ? formalities.some((value) => WORK_FORMALITY.has(value))
    : formalities.every((value) => CASUAL_FORMALITY.has(value));
}

/**
 * How much an upper-body garment covers you, roughly.
 *
 * 0 bare arms · 1 covered arms · 2 a knitted layer · 3 a real coat.
 */
function warmth(item: RecommendableItem): number {
  const text = `${item.subcategory ?? ""} ${item.name}`.toLowerCase();
  const sleeves = (item.sleeveLength ?? "").toLowerCase();

  if (item.category === "OUTERWEAR") {
    return /\b(coat|puffer|parka|trench)\b/.test(text) ? 3 : 2;
  }
  if (item.category !== "TOP" && item.category !== "DRESS") return 0;

  if (/\b(sweater|cardigan|knit|fleece|turtleneck)\b/.test(text)) return 2;
  return sleeves === "long" || sleeves === "three-quarter" ? 1 : 0;
}

/** The least covered-up an outfit may be, per season. */
const SEASON_MINIMUM_WARMTH: Record<Season, number> = {
  SUMMER: 0,
  SPRING: 0,
  FALL: 1,
  WINTER: 2,
};

/**
 * Whether an outfit works in a season.
 *
 * Two tests, because one is not enough.
 *
 * Every piece has to be *wearable* then — one wool coat rules a look out of July, and
 * an item with no seasons recorded counts as all-season so missing data never empties
 * the list.
 *
 * But that alone gets autumn wrong, and did: a t-shirt is genuinely an all-season
 * garment, since it is worn alone in July and under a sweater in January, so widening
 * it let a t-shirt-and-jeans outfit through the autumn filter with nothing over it.
 * Season-appropriateness is a property of the *outfit*, not of its pieces separately —
 * so the warmest upper-body layer has to clear a floor: covered arms by autumn, a
 * knitted layer or a coat by winter.
 */
export function suitsSeason(outfit: RecommendableOutfit, season: Season): boolean {
  const wearable = outfit.items.every(
    (item) => item.seasons.length === 0 || item.seasons.includes(season),
  );
  if (!wearable) return false;

  const floor = SEASON_MINIMUM_WARMTH[season];
  if (floor === 0) return true;

  // The warmest layer, not the total: a tee under a coat is as warm as the coat.
  return Math.max(0, ...outfit.items.map(warmth)) >= floor;
}

/** The season the given date falls in, for the default filter. */
export function seasonOf(now: Date = new Date()): Season {
  const month = now.getMonth();
  if (month <= 1 || month === 11) return "WINTER";
  if (month <= 4) return "SPRING";
  if (month <= 7) return "SUMMER";
  return "FALL";
}

/**
 * Score an outfit, higher is sooner.
 *
 * Never-worn outweighs long-unworn, because an outfit saved and never worn is the one
 * the closet is most obviously failing to use. Beyond that it is simply days since the
 * last wear, capped so that two outfits untouched for half a year don't rank by noise.
 */
function rotationScore(outfit: RecommendableOutfit, now: Date): { score: number; reason: string } {
  if (outfit.wearCount === 0 || !outfit.lastWornOn) {
    return { score: 120, reason: "Never worn" };
  }

  const days = Math.floor((now.getTime() - outfit.lastWornOn.getTime()) / DAY);
  return {
    score: Math.min(days, 100),
    reason: days <= 0 ? "Worn today" : `Not worn in ${days} ${days === 1 ? "day" : "days"}`,
  };
}

/** How well an outfit answers a typed description; 0 when nothing was typed. */
export function queryScore(outfit: RecommendableOutfit, query: string): number {
  const words = query.toLowerCase().match(/[a-z]{3,}/g) ?? [];
  if (words.length === 0) return 0;

  const text = haystack(outfit);
  const hits = new Set(words.filter((word) => text.includes(word)));
  // Scaled to dominate rotation: once the user has said what they want, matching it
  // matters more than whose turn it is.
  return hits.size * 60;
}

/**
 * What an outfit costs for repeating kinds worn in the last few days.
 *
 * Counted once per subcategory, so a two-cardigan outfit is not penalised twice, and
 * faded by recency — yesterday's cardigan weighs more than one from three days ago.
 */
export function repeatPenalty(
  outfit: RecommendableOutfit,
  recent: readonly RecentKind[],
): { keep: number; repeated: string | null } {
  if (recent.length === 0) return { keep: 1, repeated: null };

  const kindOf = (category: Category, subcategory: string | null) =>
    `${category}:${lower(subcategory) || "—"}`;

  // The freshest wear of each kind is the one that matters.
  const freshest = new Map<string, number>();
  for (const entry of recent) {
    if (entry.daysAgo > REPEAT_WINDOW_DAYS) continue;
    const key = kindOf(entry.category, entry.subcategory);
    const seen = freshest.get(key);
    if (seen === undefined || entry.daysAgo < seen) freshest.set(key, entry.daysAgo);
  }

  // Compounding, so two repeated kinds damp more than either alone.
  let keep = 1;
  let worst = 0;
  let repeated: string | null = null;

  for (const key of new Set(outfit.items.map((item) => kindOf(item.category, item.subcategory)))) {
    const daysAgo = freshest.get(key);
    if (daysAgo === undefined) continue;

    const category = key.split(":")[0] as Category;
    // Linear fade to nothing at the edge of the window.
    const freshness = 1 - daysAgo / (REPEAT_WINDOW_DAYS + 1);
    const damping = (REPEAT_DAMPING[category] ?? 0.2) * freshness;
    keep *= 1 - damping;

    if (damping > worst) {
      worst = damping;
      const kind = key.split(":")[1];
      repeated = kind === "—" ? category.toLowerCase() : kind;
    }
  }

  return { keep, repeated };
}

export function recommend({
  outfits,
  season,
  query = "",
  now = new Date(),
  recent = [],
  // Five across, so a row is a choice rather than a verdict.
  perContext = 5,
}: {
  outfits: readonly RecommendableOutfit[];
  season: Season;
  query?: string;
  now?: Date;
  /** Kinds of garment worn in the last few days, for the variety penalty. */
  recent?: readonly RecentKind[];
  perContext?: number;
}): Record<Context, Recommendation[]> {
  const eligible = outfits.filter(
    (outfit) => outfit.items.length > 0 && suitsSeason(outfit, season),
  );
  const asked = (query.match(/[a-z]{3,}/gi) ?? []).length > 0;

  const result = {} as Record<Context, Recommendation[]>;

  for (const context of CONTEXTS) {
    const scored = eligible
      .filter((outfit) => suitsContext(outfit, context))
      .map((outfit) => {
        const rotation = rotationScore(outfit, now);
        const matched = queryScore(outfit, query);
        const repeat = repeatPenalty(outfit, recent);
        return {
          outfit,
          matched,
          // Already on the calendar this week: still shown if nothing else fits, but
          // never ahead of an outfit that isn't yet spoken for.
          // Damping applies to rotation only. What the user asked for in words is not
          // less true because she wore a cardigan yesterday.
          score:
            rotation.score * repeat.keep + matched - (outfit.spokenFor ? 1000 : 0),
          reason:
            matched > 0
              ? "Matches what you asked for"
              : repeat.repeated
                ? `${rotation.reason} · ${repeat.repeated} worn recently`
                : rotation.reason,
        };
      })
      // Once the user has described something, an outfit that doesn't match is out
      // entirely — not merely outranked. Filtering on the *total* score instead let a
      // hundred-day-stale outfit beat the one she actually asked for, which is the
      // recommendation ignoring the request.
      .filter((entry) => !asked || entry.matched > 0)
      .sort((a, b) => b.score - a.score || a.outfit.name.localeCompare(b.outfit.name));

    result[context] = scored.slice(0, perContext);
  }

  return result;
}
