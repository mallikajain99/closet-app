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

  it("keeps a shoe visibly smaller than a coat", () => {
    // The rule that matters: same source, different category, different size. Without
    // it the grid loses all sense of proportion and the outfit composite is nonsense.
    const source = { width: 2000, height: 2000 };
    const shoe = fitToCategory(source, "SHOE");
    const coat = fitToCategory(source, "OUTERWEAR");

    expect(shoe.height).toBeLessThan(coat.height / 2);
  });

  it("rejects degenerate input", () => {
    expect(() => fitToCategory({ width: 0, height: 10 }, "TOP")).toThrow();
  });
});

describe("placeOnCanvas", () => {
  it("centres horizontally", () => {
    const fitted = { width: 400, height: 300 };
    const { left } = placeOnCanvas(fitted, "TOP");
    expect(left).toBe((CANVAS_SIZE - fitted.width) / 2);
  });

  it("anchors by body position rather than centring", () => {
    // Stacking the canvases should put each piece at roughly the right height, so a hat
    // sits high and shoes sit low without any per-item nudging.
    const fitted = { width: 300, height: 200 };
    const hat = placeOnCanvas(fitted, "HAT");
    const top = placeOnCanvas(fitted, "TOP");
    const bottom = placeOnCanvas(fitted, "BOTTOM");
    const shoe = placeOnCanvas(fitted, "SHOE");

    expect(hat.top).toBeLessThan(top.top);
    expect(top.top).toBeLessThan(bottom.top);
    expect(bottom.top).toBeLessThan(shoe.top);
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
