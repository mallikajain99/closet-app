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

/**
 * Maximum fraction of the canvas a category may occupy, as [width, height].
 *
 * These were originally severe — shoes capped at 26% of the canvas height — so that
 * stacking the canvases produced an outfit at human proportions. The outfit composite
 * no longer works that way: it trims each garment and rescales it against the figure
 * (`COMPOSITE_GEOMETRY` in scripts/outfit-preview.ts).
 *
 * That leaves the catalog grid as the only reader, and there the severity was a bug —
 * a pair of flats occupied a quarter of its tile and read as a thumbnail of a thumbnail.
 * The range is now compressed: enough differentiation that a shoe still isn't a coat,
 * but every item substantially fills its tile.
 */
export const CATEGORY_EXTENT: Record<Category, { width: number; height: number }> = {
  DRESS: { width: 0.86, height: 0.94 },
  OUTERWEAR: { width: 0.92, height: 0.9 },
  TOP: { width: 0.9, height: 0.84 },
  BOTTOM: { width: 0.76, height: 0.9 },
  SHOE: { width: 0.8, height: 0.62 },
  HAT: { width: 0.68, height: 0.58 },
  BAG: { width: 0.7, height: 0.7 },
  JEWELRY: { width: 0.58, height: 0.52 },
  ACCESSORY: { width: 0.72, height: 0.62 },
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
 * Where to place the fitted garment on the canvas. Centred, both axes.
 *
 * This used to anchor vertically by body position — a hat high on its canvas, shoes low
 * — so that stacking the canvases produced an outfit. The outfit composite no longer
 * works that way: it trims each garment to its own bounds and positions it against the
 * figure's height (`COMPOSITE_GEOMETRY` in scripts/outfit-preview.ts), because the grid
 * and the body want different geometry and one canvas cannot serve both.
 *
 * With the composite doing its own positioning, the baked-in anchor had no reader left
 * and only showed up as items sitting off-centre in their catalog tiles.
 *
 * Category *scale* is still applied — a shoe must not render as tall as a coat — so the
 * grid keeps its sense of proportion.
 */
export function placeOnCanvas(
  fitted: Size,
  _category: Category,
  canvas: number = CANVAS_SIZE,
): { left: number; top: number } {
  return {
    left: Math.max(0, Math.round((canvas - fitted.width) / 2)),
    top: Math.max(0, Math.round((canvas - fitted.height) / 2)),
  };
}
