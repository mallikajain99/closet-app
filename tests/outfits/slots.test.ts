import { describe, expect, it } from "vitest";
import type { Category } from "@prisma/client";

import { CATEGORY_EXTENT } from "@/lib/images/normalize";
import {
  CATEGORY_SLOT,
  byPaintOrder,
  layoutFor,
  layoutStyle,
  composeOutfit,
} from "@/lib/outfits/slots";

const percent = (value: string) => Number(value.replace("%", "")) / 100;
const subject = (category: Category) => ({ category });
const CATEGORIES = Object.keys(CATEGORY_SLOT) as Category[];

describe("layoutStyle", () => {
  it("renders each garment at its target height, not smaller", () => {
    // The bug this guards: a stored render is a square canvas the garment only partly
    // fills, and `object-contain` scales the whole canvas. Sizing the box to the target
    // rendered the garment at target × canvas-fill — shoes came out at 5% instead of
    // 8.3% and looked like a speck.
    for (const category of CATEGORIES) {
      const boxHeight = percent(layoutStyle(subject(category)).height);
      const rendered = boxHeight * CATEGORY_EXTENT[category].height;
      expect(rendered).toBeCloseTo(CATEGORY_SLOT[category].height, 5);
    }
  });

  it("keeps each garment centred on its anchor", () => {
    for (const category of CATEGORIES) {
      const { top, height } = layoutStyle(subject(category));
      const middle = percent(top) + percent(height) / 2;
      expect(middle).toBeCloseTo(CATEGORY_SLOT[category].centre, 5);
    }
  });

  it("never sizes a box taller than the frame", () => {
    // `object-contain` would switch to width-constrained and silently shrink the
    // garment below its target.
    for (const category of CATEGORIES) {
      expect(percent(layoutStyle(subject(category)).height)).toBeLessThanOrEqual(1);
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

describe("layoutFor", () => {
  it("keeps a mini skirt short instead of running it to the ankle", () => {
    // A single BOTTOM height rendered a mini skirt as long as trousers.
    const mini = layoutFor({ category: "BOTTOM", subcategory: "skirt", name: "Tan wrap mini skirt" });
    const jeans = layoutFor({ category: "BOTTOM", subcategory: "jeans", name: "Black jeans" });
    expect(mini.height).toBeLessThan(jeans.height / 2);
  });

  it("orders skirt lengths mini < midi < maxi", () => {
    const of = (name: string) => layoutFor({ category: "BOTTOM", subcategory: "skirt", name }).height;
    expect(of("mini skirt")).toBeLessThan(of("midi skirt"));
    expect(of("midi skirt")).toBeLessThan(of("maxi skirt"));
  });

  it("reads length from silhouette as well as the name", () => {
    const cropped = layoutFor({ category: "TOP", subcategory: "sweater", silhouette: ["cropped"] });
    const plain = layoutFor({ category: "TOP", subcategory: "sweater" });
    expect(cropped.height).toBeLessThan(plain.height);
  });

  it("makes a longline coat reach further than a cropped jacket", () => {
    const coat = layoutFor({ category: "OUTERWEAR", subcategory: "coat", name: "Brown longline coat" });
    const jacket = layoutFor({ category: "OUTERWEAR", subcategory: "jacket", silhouette: ["cropped"] });
    expect(coat.height).toBeGreaterThan(jacket.height * 2);
  });

  it("falls back to the category default when nothing matches", () => {
    expect(layoutFor({ category: "TOP" })).toEqual({
      height: CATEGORY_SLOT.TOP.height,
      centre: CATEGORY_SLOT.TOP.centre,
    });
  });
});

describe("composeOutfit", () => {
  it("tightens the frame when there's no hat", () => {
    // The layout reserves the top ~17% for a head, so an outfit without one rendered
    // under a large empty margin.
    const { frame } = composeOutfit([{ category: "TOP" }, { category: "BOTTOM" }]);
    expect(frame.top).toBeGreaterThan(0.05);
  });

  it("closes a gap that would read as a void", () => {
    // Shorts leave bare leg above the shoe, which is anatomically right and visually
    // broken with no body rendered behind it.
    const { placed } = composeOutfit([
      { category: "BOTTOM", subcategory: "shorts", name: "Black tailored shorts" },
      { category: "SHOE", subcategory: "sandals" },
    ]);
    const [above, below] = [...placed].sort((a, b) => a.top - b.top);
    expect(below.top - (above.top + above.height)).toBeLessThanOrEqual(0.05);
  });

  it("leaves naturally overlapping pieces where they are", () => {
    // A shirt already covers the trouser waist; nothing should move.
    const items = [
      { category: "TOP" as const, subcategory: "shirt" },
      { category: "BOTTOM" as const, subcategory: "trousers" },
    ];
    const { placed } = composeOutfit(items);
    const top = placed.find((p) => p.item.category === "TOP")!;
    expect(top.top).toBeCloseTo(layoutFor(items[0]).centre - layoutFor(items[0]).height / 2, 5);
  });

  it("keeps the frame tall enough for the largest box", () => {
    // Otherwise `overflow-hidden` crops the garment with nothing to notice.
    const { placed, frame } = composeOutfit([
      { category: "BOTTOM", subcategory: "shorts" },
      { category: "SHOE" },
    ]);
    const span = frame.bottom - frame.top;
    for (const p of placed) {
      expect(p.height / CATEGORY_EXTENT[p.item.category].height).toBeLessThanOrEqual(span + 1e-9);
    }
  });

  it("returns an empty layout for an empty outfit", () => {
    expect(composeOutfit([])).toEqual({ placed: [], frame: { top: 0, bottom: 1 } });
  });
});
