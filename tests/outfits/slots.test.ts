import { describe, expect, it } from "vitest";
import type { Category } from "@prisma/client";

import { CATEGORY_EXTENT } from "@/lib/images/normalize";
import {
  CATEGORY_SLOT,
  FLOOR,
  SHOULDER,
  WAIST,
  byPaintOrder,
  composeOutfit,
  layoutFor,
} from "@/lib/outfits/slots";

const CATEGORIES = Object.keys(CATEGORY_SLOT) as Category[];

describe("landmark anchoring", () => {
  it("hangs every upper-body garment from the same shoulder line", () => {
    // The point of anchoring by landmark: a longer top extends its hem, it does not
    // push its own shoulders up. Centre-anchoring moved both edges at once, so tops
    // and trousers met in a different place for every combination.
    const top = layoutFor({ category: "TOP" });
    const coat = layoutFor({ category: "OUTERWEAR", subcategory: "coat" });
    const cropped = layoutFor({ category: "TOP", silhouette: ["cropped"] });

    expect(top.top).toBeCloseTo(SHOULDER, 5);
    expect(coat.top).toBeCloseTo(SHOULDER, 5);
    expect(cropped.top).toBeCloseTo(SHOULDER, 5);
  });

  it("hangs every lower-body garment from the waist", () => {
    for (const sub of ["trousers", "jeans", "shorts", "mini skirt", "midi skirt"]) {
      expect(layoutFor({ category: "BOTTOM", subcategory: sub }).top).toBeCloseTo(WAIST, 5);
    }
  });

  it("stands shoes on the floor, fixing their bottom edge", () => {
    const shoe = layoutFor({ category: "SHOE" });
    expect(shoe.top + shoe.height).toBeCloseTo(FLOOR, 5);
  });

  it("overlaps a top with the waistband rather than leaving a seam", () => {
    const top = layoutFor({ category: "TOP" });
    const jeans = layoutFor({ category: "BOTTOM", subcategory: "jeans" });
    expect(top.top + top.height).toBeGreaterThan(jeans.top);
  });

  it("changes only the hem when a garment is shorter", () => {
    const full = layoutFor({ category: "BOTTOM", subcategory: "jeans" });
    const mini = layoutFor({ category: "BOTTOM", subcategory: "mini skirt" });
    expect(mini.top).toBeCloseTo(full.top, 5);
    expect(mini.height).toBeLessThan(full.height);
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
    // Meaningfully shorter, not an exact ratio — the numbers are tuned by eye and a
    // tight bound just breaks every time they move.
    expect(mini.height).toBeLessThan(jeans.height * 0.7);
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
      top: CATEGORY_SLOT.TOP.anchor,
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
    expect(top.top).toBeCloseTo(layoutFor(items[0]).top, 5);
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
