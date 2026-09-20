import { CATEGORY_EXTENT } from "@/lib/images/normalize";
import type { Category, Slot } from "@prisma/client";

/**
 * Where each category sits in an outfit, and how the garment is laid out there.
 *
 * `height` and `centre` are fractions of the figure's height — not of the canvas. They
 * come from the Phase 2.5 calibration (see PLAN.md §1.1): the catalog grid wants a
 * garment to fill its tile, a body wants it at body proportions, and one set of numbers
 * cannot serve both. `scripts/outfit-preview.ts` renders from this same table, so the
 * calibration tool and the app can't drift.
 *
 * `z` is paint order, back to front. A jacket goes over a top; a top goes over a
 * waistband.
 */
export type SlotLayout = {
  slot: Slot;
  label: string;
  /** Fraction of the figure's height the garment occupies. */
  height: number;
  /**
   * The body landmark the garment hangs from, and which of its edges meets it.
   *
   * Anchoring by landmark rather than by centre is what keeps garments aligned with
   * each other: every top starts at the shoulder line and every bottom starts at the
   * waist, so a longer top extends further down instead of pushing its own shoulders
   * up. Centre-anchoring moved both edges whenever a length changed, which is why
   * tops and trousers met in a different place for every combination.
   */
  anchor: number;
  edge: "top" | "bottom";
  z: number;
};

/** Body landmarks, crown 0 to soles 1. */
export const SHOULDER = 0.17;
export const WAIST = 0.45;
export const FLOOR = 1;

/**
 * Set from where a garment actually falls on a body, crown 0 to soles 1:
 * shoulders 0.17, waist 0.45, hip 0.52, knee 0.73, ankle 0.95.
 *
 * An earlier set was derived by eye against a placeholder figure and was badly out — a
 * cardigan spanned 0.16 to 0.67, shoulders to mid-thigh, while jeans ran 0.57 to 0.97,
 * starting at the hip and stopping short. That produced a dominant top over stunted
 * legs, which is what "the rendering looks off" was pointing at.
 *
 * Categories deliberately overlap: a top covers the waistband, shoes overlap the hem.
 * The paint order below decides what wins.
 */
export const CATEGORY_SLOT: Record<Category, SlotLayout> = {
  // Sits on the head.
  HAT: { slot: "HEAD", label: "Hat", height: 0.12, anchor: 0.02, edge: "top", z: 60 },
  JEWELRY: { slot: "JEWELRY", label: "Jewelry", height: 0.06, anchor: SHOULDER, edge: "top", z: 70 },
  ACCESSORY: { slot: "OTHER", label: "Accessory", height: 0.1, anchor: 0.2, edge: "top", z: 65 },

  // Everything worn on the upper body hangs from the shoulders, so they all share one
  // anchor and only their hems differ.
  TOP: { slot: "TOP", label: "Top", height: 0.31, anchor: SHOULDER, edge: "top", z: 30 },
  OUTERWEAR: { slot: "OUTER", label: "Outerwear", height: 0.42, anchor: SHOULDER, edge: "top", z: 40 },
  DRESS: { slot: "TOP", label: "Dress", height: 0.58, anchor: SHOULDER, edge: "top", z: 30 },

  // Everything worn on the lower body hangs from the waist.
  BOTTOM: { slot: "BOTTOM", label: "Bottom", height: 0.5, anchor: WAIST, edge: "top", z: 20 },

  // Shoes stand on the floor, so it is their *bottom* edge that is fixed. Deliberately
  // larger than anatomy: a foot is ~5% of height seen front-on, but these photos show a
  // whole shoe from the front, so the true figure renders as a speck.
  SHOE: { slot: "SHOES", label: "Shoes", height: 0.13, anchor: FLOOR, edge: "bottom", z: 50 },

  BAG: { slot: "BAG", label: "Bag", height: 0.18, anchor: 0.46, edge: "top", z: 55 },
};

/**
 * The slots the builder offers, head to toe.
 *
 * A slot with nothing to put in it is hidden at render time rather than listed here, so
 * this can stay the full set: an empty carousel reads as broken, but a missing one just
 * looks like a shorter form.
 */
export const BUILDER_SLOTS = [
  { slot: "HEAD" as Slot, label: "Hat", categories: ["HAT"] as Category[] },
  { slot: "OUTER" as Slot, label: "Outerwear", categories: ["OUTERWEAR"] as Category[] },
  { slot: "TOP" as Slot, label: "Top", categories: ["TOP", "DRESS"] as Category[] },
  { slot: "BOTTOM" as Slot, label: "Bottom", categories: ["BOTTOM"] as Category[] },
  { slot: "SHOES" as Slot, label: "Shoes", categories: ["SHOE"] as Category[] },
  { slot: "BAG" as Slot, label: "Bag", categories: ["BAG"] as Category[] },
] as const;

/**
 * Length overrides, because one number per category is not enough.
 *
 * A mini skirt rendered waist-to-ankle like trousers, and a cropped cardigan rendered
 * like a coat. The category says where a garment starts; only the garment itself says
 * where it ends — and it does say, in its subcategory, silhouette and name: "wrap mini
 * skirt", "cropped", "longline coat".
 *
 * Matched most specific first, against subcategory + silhouette + name. A garment that
 * matches nothing keeps its category default, so this only ever sharpens the guess.
 */
const LENGTH_OVERRIDES: Array<{
  match: RegExp;
  categories: Category[];
  height: number;
}> = [
  // Only the hem moves: a mini skirt still hangs from the waist, it just stops sooner.
  // Waist 0.45, mid-thigh 0.62, knee 0.73, calf 0.85, ankle 0.95.
  { match: /\bshorts\b/i, categories: ["BOTTOM"], height: 0.17 },
  { match: /\bmini\b/i, categories: ["BOTTOM"], height: 0.27 },
  { match: /\bmidi\b/i, categories: ["BOTTOM"], height: 0.38 },
  { match: /\bmaxi\b/i, categories: ["BOTTOM"], height: 0.5 },
  // A skirt with no stated length: knee, the safe middle.
  { match: /\bskirt\b/i, categories: ["BOTTOM"], height: 0.28 },

  // Cropped stops above the waist; longline passes the hip.
  { match: /\bcropped\b/i, categories: ["TOP"], height: 0.22 },
  { match: /\bcropped\b/i, categories: ["OUTERWEAR"], height: 0.26 },
  { match: /\blongline|long coat|trench|maxi\b/i, categories: ["OUTERWEAR"], height: 0.68 },
  { match: /\bcoat\b/i, categories: ["OUTERWEAR"], height: 0.58 },
  { match: /\bmini\b/i, categories: ["DRESS"], height: 0.4 },
  { match: /\bmaxi\b/i, categories: ["DRESS"], height: 0.78 },
];


/** Everything about a garment that bears on how long it is. */
export type LayoutSubject = {
  category: Category;
  subcategory?: string | null;
  name?: string | null;
  silhouette?: readonly string[];
};

/**
 * Where this particular garment sits: its landmark, plus its own length.
 *
 * Returns the top edge rather than the centre, because the landmark is what must stay
 * put. A shorter hem moves the hem, never the shoulders.
 */
export function layoutFor(subject: LayoutSubject): { height: number; top: number } {
  const base = CATEGORY_SLOT[subject.category];
  const text = [subject.subcategory, subject.name, ...(subject.silhouette ?? [])]
    .filter(Boolean)
    .join(" ");

  const override = LENGTH_OVERRIDES.find(
    (rule) => rule.categories.includes(subject.category) && rule.match.test(text),
  );

  const height = override?.height ?? base.height;
  const top = base.edge === "top" ? base.anchor : base.anchor - height;

  return { height, top };
}

/** Paint order for a set of chosen categories, back to front. */
export function byPaintOrder<T extends { category: Category }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => CATEGORY_SLOT[a.category].z - CATEGORY_SLOT[b.category].z);
}



/**
 * The largest gap allowed between two stacked garments, as a fraction of the figure.
 *
 * Anatomically a gap is often correct — shorts really do leave bare leg above the
 * shoe. But with no body rendered behind them, a quarter-figure void reads as a broken
 * layout rather than as legs, and the outfits that look right are precisely the ones
 * whose pieces happen to overlap.
 */
const MAX_GAP = 0.04;

export type PlacedGarment<T> = { item: T; top: number; height: number };

/**
 * Lay out a whole outfit: anatomical positions, then gaps closed, then fitted to frame.
 *
 * Done for the set rather than per garment because closing a gap moves everything below
 * it — a decision that cannot be made looking at one piece at a time.
 */
export function composeOutfit<T extends LayoutSubject>(
  items: readonly T[],
): { placed: PlacedGarment<T>[]; frame: { top: number; bottom: number } } {
  if (items.length === 0) return { placed: [], frame: { top: 0, bottom: 1 } };

  const spans = items
    .map((item) => ({ item, ...layoutFor(item) }))
    .sort((a, b) => a.top - b.top);

  // Walk down the figure pulling each garment up to meet the one above. `reach` is the
  // lowest point covered so far, not the previous garment's hem: a coat spans the top
  // and the bottom, and measuring against it is what keeps shoes under the hem rather
  // than under the jacket.
  let reach = spans[0].top + spans[0].height;
  let shift = 0;

  for (let i = 1; i < spans.length; i += 1) {
    const span = spans[i];
    const adjustedTop = span.top - shift;
    const gap = adjustedTop - reach;
    if (gap > MAX_GAP) shift += gap - MAX_GAP;

    span.top -= shift;
    reach = Math.max(reach, span.top + span.height);
  }

  const padding = 0.04;
  let top = Math.min(...spans.map((s) => s.top)) - padding;
  let bottom = Math.max(...spans.map((s) => s.top + s.height)) + padding;

  /**
   * Guarantee the frame is tall enough for the largest *box*, not just the largest
   * garment.
   *
   * A box is enlarged by the canvas-fill correction, so it exceeds the garment it
   * holds. Once gap-closing tightens the frame — a shorts outfit collapses a long way —
   * a box can end up taller than the frame, which `overflow-hidden` then crops without
   * any error to notice.
   */
  const tallestBox = Math.max(
    ...spans.map((s) => s.height / CATEGORY_EXTENT[s.item.category].height),
  );
  // A little headroom so rounding can never push a box past the frame edge.
  const deficit = tallestBox * 1.02 - (bottom - top);
  if (deficit > 0) {
    top -= deficit / 2;
    bottom += deficit / 2;
  }

  return { placed: spans, frame: { top, bottom } };
}
