import Image from "next/image";

import { CANVAS_SIZE, CATEGORY_EXTENT } from "@/lib/images/normalize";
import { byPaintOrder, composeOutfit } from "@/lib/outfits/slots";
import type { Category } from "@prisma/client";

export type FigureItem = {
  id: string;
  name: string;
  category: Category;
  /** Length cues — a mini skirt must not render waist-to-ankle like trousers. */
  subcategory?: string | null;
  silhouette?: readonly string[];
  /**
   * Measured height of the garment within its 1024px render.
   *
   * Without it the layout falls back to the per-category maximum, which overstates the
   * garment by 11% on average and 59% at worst — bottoms especially, since they are
   * width-constrained in their canvas rather than height-constrained.
   */
  renderHeight?: number | null;
  imageUrl: string | null;
};

/**
 * An outfit rendered as layered garments at body proportions.
 *
 * Composited in the DOM rather than server-side with `sharp`, because the builder needs
 * it to update the instant a carousel selection changes — a round trip per tap would
 * make choosing between twenty tops unbearable. The geometry is the same table the
 * calibration script uses, expressed as percentages so one component serves both a
 * thumbnail and a full-size preview.
 *
 * No figure behind it: judged against real garments, a stack reads cleaner than the
 * mannequin and matches the "let the clothes shine" direction. A photo of the outfit
 * worn replaces this entirely once one exists (spec §2).
 */
export function OutfitFigure({
  items,
  className = "",
  sizes = "400px",
}: {
  items: readonly FigureItem[];
  className?: string;
  sizes?: string;
}) {
  // Lay the whole outfit out first — closing a gap moves everything below it — then
  // paint back to front.
  const { placed, frame } = composeOutfit(items);
  const span = Math.max(0.01, frame.bottom - frame.top);
  const positions = new Map(placed.map((p) => [p.item.id, p]));
  const layered = byPaintOrder(items);

  return (
    /**
     * 2:3 — a standing figure is far taller than it is wide, and a wider frame left the
     * stack marooned in whitespace.
     *
     * The ratio comes from padding rather than `aspect-ratio`, and the layers live in an
     * `inset-0` child. Each layer sets a percentage height, and a percentage resolves
     * against the containing block's height — which an `aspect-ratio` box does not
     * reliably provide, so every layer collapsed to zero and the outfit rendered blank.
     * Padding gives the wrapper a definite height, and `inset-0` passes it down.
     */
    <div className={`relative w-full overflow-hidden ${className}`}>
      <div style={{ paddingTop: "150%" }} />
      <div className="absolute inset-0">
      {layered.map((item) => {
        const position = positions.get(item.id);
        if (!item.imageUrl || !position) return null;

        // The stored render is a square canvas the garment only partly fills, and
        // `object-contain` scales the whole canvas — so the box has to be enlarged by
        // the fill fraction or the garment lands smaller than its target. Measured
        // where known; the category maximum is only a fallback for unmeasured items.
        const fill = item.renderHeight
          ? item.renderHeight / CANVAS_SIZE
          : CATEGORY_EXTENT[item.category].height;
        const boxHeight = position.height / fill;
        const centre = position.top + position.height / 2;
        const top = `${((centre - frame.top) / span - boxHeight / span / 2) * 100}%`;
        const height = `${(boxHeight / span) * 100}%`;

        return (
          <div
            key={item.id}
            // Full width with the garment centred inside: the render is already centred
            // on its own canvas, so the box only has to place it vertically.
            className="absolute inset-x-0"
            style={{ top, height }}
          >
            <Image
              src={item.imageUrl}
              alt={item.name}
              fill
              unoptimized
              sizes={sizes}
              className="object-contain"
            />
          </div>
        );
      })}
      </div>
    </div>
  );
}
