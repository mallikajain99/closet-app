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
  SHOE: { slot: "SHOES", label: "Shoes", height: 0.075, centre: 0.962, z: 50 },
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
export function layoutStyle(category: Category) {
  const { height, centre } = CATEGORY_SLOT[category];
  const boxHeight = height / CATEGORY_EXTENT[category].height;

  return {
    top: `${(centre - boxHeight / 2) * 100}%`,
    height: `${boxHeight * 100}%`,
  };
}
