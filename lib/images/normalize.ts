import type { Category } from "@prisma/client";

/**
 * Normalization geometry (spec §1).
 *
 * Every processed garment lands on the same square, transparent canvas, scaled by
 * category. The scale is the point: without it a shoe and a winter coat both fill their
 * tile, the grid loses all sense of proportion, and the outfit composite puts a sneaker
 * the same height as a parka.
 *
 * These are fractions of the canvas edge, chosen so a head-to-toe stack of top + bottom
 * + shoes reads at roughly human proportions.
 */
export const CANVAS_SIZE = 1024;
export const THUMBNAIL_SIZE = 256;

/** Maximum fraction of the canvas a category may occupy, as [width, height]. */
export const CATEGORY_EXTENT: Record<Category, { width: number; height: number }> = {
  DRESS: { width: 0.82, height: 0.96 },
  OUTERWEAR: { width: 0.92, height: 0.78 },
  TOP: { width: 0.88, height: 0.62 },
  BOTTOM: { width: 0.7, height: 0.86 },
  SHOE: { width: 0.46, height: 0.26 },
  HAT: { width: 0.42, height: 0.28 },
  BAG: { width: 0.44, height: 0.4 },
  JEWELRY: { width: 0.34, height: 0.24 },
  ACCESSORY: { width: 0.5, height: 0.34 },
};

export type Size = { width: number; height: number };

/**
 * Fit a trimmed garment inside its category's box, preserving aspect ratio.
 *
 * Never enlarges: a small source image stays small rather than being upscaled into a
 * soft, blurry version of itself. Returned dimensions are whole pixels, since they feed
 * straight into a resize.
 */
export function fitToCategory(
  source: Size,
  category: Category,
  canvas: number = CANVAS_SIZE,
): Size {
  if (source.width <= 0 || source.height <= 0) {
    throw new Error("Source dimensions must be positive.");
  }

  const extent = CATEGORY_EXTENT[category];
  const maxWidth = canvas * extent.width;
  const maxHeight = canvas * extent.height;

  const scale = Math.min(maxWidth / source.width, maxHeight / source.height, 1);

  return {
    width: Math.max(1, Math.round(source.width * scale)),
    height: Math.max(1, Math.round(source.height * scale)),
  };
}

/**
 * Where to place the fitted garment on the canvas.
 *
 * Horizontally centred. Vertically, items are anchored by where they sit on a body
 * rather than centred: a hat belongs near the top of its canvas and shoes near the
 * bottom, so that stacking the canvases in the outfit composite puts each piece at
 * roughly the right height without per-item nudging.
 */
const VERTICAL_ANCHOR: Record<Category, number> = {
  HAT: 0.1,
  TOP: 0.35,
  OUTERWEAR: 0.4,
  DRESS: 0.45,
  JEWELRY: 0.3,
  BAG: 0.5,
  ACCESSORY: 0.5,
  BOTTOM: 0.6,
  SHOE: 0.9,
};

export function placeOnCanvas(
  fitted: Size,
  category: Category,
  canvas: number = CANVAS_SIZE,
): { left: number; top: number } {
  const anchor = VERTICAL_ANCHOR[category];

  const left = Math.round((canvas - fitted.width) / 2);
  // Anchor is the fraction of the canvas the item's centre sits at.
  const rawTop = Math.round(canvas * anchor - fitted.height / 2);

  return {
    left: Math.max(0, Math.min(left, canvas - fitted.width)),
    top: Math.max(0, Math.min(rawTop, canvas - fitted.height)),
  };
}
