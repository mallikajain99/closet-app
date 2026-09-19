import { describe, expect, it } from "vitest";
import type { Category } from "@prisma/client";

import { CATEGORY_EXTENT } from "@/lib/images/normalize";
import { CATEGORY_SLOT, byPaintOrder, layoutStyle } from "@/lib/outfits/slots";

const percent = (value: string) => Number(value.replace("%", "")) / 100;
const CATEGORIES = Object.keys(CATEGORY_SLOT) as Category[];

describe("layoutStyle", () => {
  it("renders each garment at its target height, not smaller", () => {
    // The bug this guards: a stored render is a square canvas the garment only partly
    // fills, and `object-contain` scales the whole canvas. Sizing the box to the target
    // rendered the garment at target × canvas-fill — shoes came out at 5% instead of
    // 8.3% and looked like a speck.
    for (const category of CATEGORIES) {
      const boxHeight = percent(layoutStyle(category).height);
      const rendered = boxHeight * CATEGORY_EXTENT[category].height;
      expect(rendered).toBeCloseTo(CATEGORY_SLOT[category].height, 5);
    }
  });

  it("keeps each garment centred on its anchor", () => {
    for (const category of CATEGORIES) {
      const { top, height } = layoutStyle(category);
      const middle = percent(top) + percent(height) / 2;
      expect(middle).toBeCloseTo(CATEGORY_SLOT[category].centre, 5);
    }
  });

  it("never sizes a box taller than the frame", () => {
    // `object-contain` would switch to width-constrained and silently shrink the
    // garment below its target.
    for (const category of CATEGORIES) {
      expect(percent(layoutStyle(category).height)).toBeLessThanOrEqual(1);
    }
  });

  it("puts shoes below bottoms, and bottoms below tops", () => {
    expect(CATEGORY_SLOT.TOP.centre).toBeLessThan(CATEGORY_SLOT.BOTTOM.centre);
    expect(CATEGORY_SLOT.BOTTOM.centre).toBeLessThan(CATEGORY_SLOT.SHOE.centre);
    expect(CATEGORY_SLOT.HAT.centre).toBeLessThan(CATEGORY_SLOT.TOP.centre);
  });
});

describe("byPaintOrder", () => {
  it("paints outerwear over the top, and the top over the waistband", () => {
    const order = byPaintOrder([
      { category: "OUTERWEAR" as Category },
      { category: "BOTTOM" as Category },
      { category: "TOP" as Category },
    ]).map((item) => item.category);

    expect(order).toEqual(["BOTTOM", "TOP", "OUTERWEAR"]);
  });

  it("paints shoes and accessories in front of the clothes", () => {
    const order = byPaintOrder([
      { category: "SHOE" as Category },
      { category: "OUTERWEAR" as Category },
    ]).map((item) => item.category);

    expect(order).toEqual(["OUTERWEAR", "SHOE"]);
  });

  it("does not mutate the input", () => {
    const input = [{ category: "SHOE" as Category }, { category: "TOP" as Category }];
    byPaintOrder(input);
    expect(input[0].category).toBe("SHOE");
  });
});
