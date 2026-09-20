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
  /** How far down the figure its middle sits — 0 at the crown, 1 at the soles. */
  centre: number;
  z: number;
};

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
  // Crown to chin.
  HAT: { slot: "HEAD", label: "Hat", height: 0.12, centre: 0.065, z: 60 },
  JEWELRY: { slot: "JEWELRY", label: "Jewelry", height: 0.06, centre: 0.2, z: 70 },
  ACCESSORY: { slot: "OTHER", label: "Accessory", height: 0.1, centre: 0.25, z: 65 },
  // Shoulders to hip.
  TOP: { slot: "TOP", label: "Top", height: 0.35, centre: 0.345, z: 30 },
  // Shoulders to just below the hip. One number can't tell a cropped cardigan from a
  // longline coat — that is what `Item.layoutScale`/`layoutOffset` are reserved for.
  OUTERWEAR: { slot: "OUTER", label: "Outerwear", height: 0.42, centre: 0.38, z: 40 },
  // Shoulders to knee.
  DRESS: { slot: "TOP", label: "Dress", height: 0.58, centre: 0.46, z: 30 },
  // Waist to ankle — the longest garment on the figure, not the shortest.
  BOTTOM: { slot: "BOTTOM", label: "Bottom", height: 0.5, centre: 0.7, z: 20 },
  // Deliberately larger than anatomy: a foot is ~5% of height seen front-on, but these
  // photos show a whole shoe from the front rather than a foreshortened foot, so the
  // true figure renders as a speck. Sized for visual balance instead.
  SHOE: { slot: "SHOES", label: "Shoes", height: 0.13, centre: 0.935, z: 50 },
  BAG: { slot: "BAG", label: "Bag", height: 0.18, centre: 0.55, z: 55 },
};

/**
 * The slots the builder offers, head to toe.
 *
 * Only these five for now: they are what the catalog can fill, and an outfit builder
 * with three permanently empty carousels reads as broken rather than as extensible.
 */
export const BUILDER_SLOTS = [
  { slot: "OUTER" as Slot, label: "Outerwear", categories: ["OUTERWEAR"] as Category[] },
  { slot: "TOP" as Slot, label: "Top", categories: ["TOP", "DRESS"] as Category[] },
  { slot: "BOTTOM" as Slot, label: "Bottom", categories: ["BOTTOM"] as Category[] },
  { slot: "SHOES" as Slot, label: "Shoes", categories: ["SHOE"] as Category[] },
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
  centre: number;
}> = [
  // Waist 0.45, mid-thigh 0.62, knee 0.73, calf 0.85, ankle 0.95.
  { match: /\bshorts\b/i, categories: ["BOTTOM"], height: 0.17, centre: 0.535 },
  { match: /\bmini\b/i, categories: ["BOTTOM"], height: 0.2, centre: 0.55 },
  { match: /\bmidi\b/i, categories: ["BOTTOM"], height: 0.38, centre: 0.64 },
  { match: /\bmaxi\b/i, categories: ["BOTTOM"], height: 0.5, centre: 0.7 },
  // A skirt with no stated length: knee, the safe middle.
  { match: /\bskirt\b/i, categories: ["BOTTOM"], height: 0.28, centre: 0.59 },

  // Shoulders 0.17. Cropped stops above the waist; longline passes the hip.
  { match: /\bcropped\b/i, categories: ["TOP"], height: 0.25, centre: 0.295 },
  { match: /\bcropped\b/i, categories: ["OUTERWEAR"], height: 0.28, centre: 0.31 },
  {
    match: /\blongline|long coat|trench|maxi\b/i,
    categories: ["OUTERWEAR"],
    height: 0.68,
    centre: 0.51,
  },
  { match: /\bcoat\b/i, categories: ["OUTERWEAR"], height: 0.58, centre: 0.46 },
  { match: /\bmini\b/i, categories: ["DRESS"], height: 0.4, centre: 0.37 },
  { match: /\bmaxi\b/i, categories: ["DRESS"], height: 0.78, centre: 0.56 },
];

/** Everything about a garment that bears on how long it is. */
export type LayoutSubject = {
  category: Category;
  subcategory?: string | null;
  name?: string | null;
  silhouette?: readonly string[];
};

/** Where this particular garment sits, category default sharpened by its own length. */
export function layoutFor(subject: LayoutSubject): { height: number; centre: number } {
  const base = CATEGORY_SLOT[subject.category];
  const text = [subject.subcategory, subject.name, ...(subject.silhouette ?? [])]
    .filter(Boolean)
    .join(" ");

  const override = LENGTH_OVERRIDES.find(
    (rule) => rule.categories.includes(subject.category) && rule.match.test(text),
  );

  return override
    ? { height: override.height, centre: override.centre }
    : { height: base.height, centre: base.centre };
}

/** Paint order for a set of chosen categories, back to front. */
export function byPaintOrder<T extends { category: Category }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => CATEGORY_SLOT[a.category].z - CATEGORY_SLOT[b.category].z);
}

/**
 * CSS box for one garment, as percentages of the figure frame.
 *
 * Returned as percentages rather than pixels so the same outfit renders identically at
 * any size — a 200px card in the outfit list and a 600px builder preview.
 *
 * The box is deliberately *larger* than the garment should be. A stored render is a
 * square canvas with the garment occupying only `CATEGORY_EXTENT[category].height` of
 * it, and `object-contain` scales the whole canvas — so sizing the box to the target
 * renders the garment at target × canvas-fill instead. Dividing by the fill undoes it.
 *
 * Without this the error compounds worst where the fill is smallest: shoes came out at
 * 0.083 × 0.62 ≈ 5% of the figure instead of 8.3%, which read as a speck under a
 * full-size cardigan. The server-side calibration script doesn't need the correction
 * because it trims each render to the garment's own bounds before scaling.
 */
export function layoutStyle(
  subject: LayoutSubject,
  frame: { top: number; bottom: number } = { top: 0, bottom: 1 },
) {
  const { height, centre } = layoutFor(subject);
  const boxHeight = height / CATEGORY_EXTENT[subject.category].height;

  // Rescale from figure coordinates into the visible band, so an outfit with no hat
  // isn't rendered small under an empty head-sized margin.
  const span = Math.max(0.01, frame.bottom - frame.top);
  const scaledHeight = boxHeight / span;
  const scaledCentre = (centre - frame.top) / span;

  return {
    top: `${(scaledCentre - scaledHeight / 2) * 100}%`,
    height: `${scaledHeight * 100}%`,
  };
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
    .map((item) => {
      const { height, centre } = layoutFor(item);
      return { item, top: centre - height / 2, height };
    })
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
