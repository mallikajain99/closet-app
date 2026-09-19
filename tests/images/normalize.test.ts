import { describe, expect, it } from "vitest";

import {
  CANVAS_SIZE,
  CATEGORY_EXTENT,
  fitToCategory,
  placeOnCanvas,
} from "@/lib/images/normalize";

describe("fitToCategory", () => {
  it("scales a tall garment to its category height", () => {
    const fitted = fitToCategory({ width: 2000, height: 3000 }, "TOP");
    expect(fitted.height).toBe(Math.round(CANVAS_SIZE * CATEGORY_EXTENT.TOP.height));
  });

  it("preserves aspect ratio", () => {
    const fitted = fitToCategory({ width: 1000, height: 2000 }, "OUTERWEAR");
    expect(fitted.height / fitted.width).toBeCloseTo(2, 1);
  });

  it("constrains by width when the garment is wide", () => {
    // A wide, short item hits the width limit before the height limit.
    const fitted = fitToCategory({ width: 4000, height: 1000 }, "SHOE");
    expect(fitted.width).toBe(Math.round(CANVAS_SIZE * CATEGORY_EXTENT.SHOE.width));
    expect(fitted.height).toBeLessThan(CANVAS_SIZE * CATEGORY_EXTENT.SHOE.height + 1);
  });

  it("never enlarges a small source", () => {
    // Upscaling would just produce a soft, blurry version of the same image.
    const source = { width: 120, height: 90 };
    expect(fitToCategory(source, "TOP")).toEqual(source);
  });

  it("keeps a shoe smaller than a coat, but not by much", () => {
    // Same source, different category, different size — otherwise the grid loses any
    // sense of proportion. The range is deliberately narrow now: the outfit composite
    // rescales against the figure itself, so severity here only made a pair of flats
    // occupy a quarter of its catalog tile.
    const source = { width: 2000, height: 2000 };
    const shoe = fitToCategory(source, "SHOE");
    const coat = fitToCategory(source, "OUTERWEAR");

    expect(shoe.height).toBeLessThan(coat.height);
    expect(shoe.height).toBeGreaterThan(coat.height / 2);
  });

  it("rejects degenerate input", () => {
    expect(() => fitToCategory({ width: 0, height: 10 }, "TOP")).toThrow();
  });
});

describe("placeOnCanvas", () => {
  it("centres on both axes", () => {
    const fitted = { width: 400, height: 300 };
    const { left, top } = placeOnCanvas(fitted, "TOP");
    expect(left).toBe((CANVAS_SIZE - fitted.width) / 2);
    expect(top).toBe((CANVAS_SIZE - fitted.height) / 2);
  });

  it("places every category identically", () => {
    // Position is no longer category-dependent: the outfit composite anchors garments
    // against the figure itself, so baking an anchor in here only pushed items
    // off-centre in their catalog tiles. Scale is still per-category — see fitToCategory.
    const fitted = { width: 300, height: 200 };
    const placements = (["HAT", "TOP", "BOTTOM", "SHOE", "DRESS"] as const).map((category) =>
      placeOnCanvas(fitted, category),
    );

    for (const placement of placements) {
      expect(placement).toEqual(placements[0]);
    }
  });

  it("never places an item off the canvas", () => {
    const tall = { width: 900, height: 1000 };
    for (const category of ["HAT", "SHOE", "DRESS"] as const) {
      const { left, top } = placeOnCanvas(tall, category);
      expect(left).toBeGreaterThanOrEqual(0);
      expect(top).toBeGreaterThanOrEqual(0);
      expect(top + tall.height).toBeLessThanOrEqual(CANVAS_SIZE);
      expect(left + tall.width).toBeLessThanOrEqual(CANVAS_SIZE);
    }
  });
});
