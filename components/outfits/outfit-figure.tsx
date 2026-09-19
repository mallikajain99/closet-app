import Image from "next/image";

import { byPaintOrder, layoutStyle } from "@/lib/outfits/slots";
import type { Category } from "@prisma/client";

export type FigureItem = {
  id: string;
  name: string;
  category: Category;
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
  const layered = byPaintOrder(items);

  return (
    <div className={`relative aspect-[3/4] w-full overflow-hidden ${className}`}>
      {layered.map((item) => {
        if (!item.imageUrl) return null;
        const { top, height } = layoutStyle(item.category);

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
  );
}
