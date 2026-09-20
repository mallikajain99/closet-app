import type { Season } from "@prisma/client";

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
  subcategory: string | null;
  brand: string | null;
  colors: string[];
  seasons: Season[];
  formality: string | null;
  material: string | null;
};

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

/** Formality values that read as workwear, and as off-duty. */
const WORK_FORMALITY = new Set(["smart", "dressy", "formal"]);
const CASUAL_FORMALITY = new Set(["casual", "simple"]);

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
 * Whether an outfit works in a season.
 *
 * Every piece has to be wearable then — one wool coat is enough to rule a look out of
 * July. An item with no seasons recorded is treated as all-season rather than as
 * no-season, so missing data never silently empties the list.
 */
export function suitsSeason(outfit: RecommendableOutfit, season: Season): boolean {
  return outfit.items.every(
    (item) => item.seasons.length === 0 || item.seasons.includes(season),
  );
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

export function recommend({
  outfits,
  season,
  query = "",
  now = new Date(),
  perContext = 3,
}: {
  outfits: readonly RecommendableOutfit[];
  season: Season;
  query?: string;
  now?: Date;
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
        return {
          outfit,
          matched,
          // Already on the calendar this week: still shown if nothing else fits, but
          // never ahead of an outfit that isn't yet spoken for.
          score: rotation.score + matched - (outfit.spokenFor ? 1000 : 0),
          reason: matched > 0 ? "Matches what you asked for" : rotation.reason,
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
