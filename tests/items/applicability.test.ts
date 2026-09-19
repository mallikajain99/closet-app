import { describe, expect, it } from "vitest";
import type { Category } from "@prisma/client";

import {
  buildAttributes,
  fieldApplies,
  itemInputSchema,
  type ItemInput,
} from "@/lib/validation/item";

/** Parsed through the real schema so defaults and transforms match a genuine submission. */
function input(overrides: Record<string, unknown> = {}): ItemInput {
  return itemInputSchema.parse({ name: "Thing", category: "TOP", ...overrides });
}

describe("fieldApplies", () => {
  it("offers sleeve length only to garments with sleeves", () => {
    for (const category of ["TOP", "DRESS", "OUTERWEAR"] as Category[]) {
      expect(fieldApplies("sleeveLength", category)).toBe(true);
    }
    for (const category of ["BOTTOM", "SHOE", "HAT", "BAG", "JEWELRY"] as Category[]) {
      expect(fieldApplies("sleeveLength", category)).toBe(false);
    }
  });

  it("offers silhouette to clothing but not to accessories", () => {
    expect(fieldApplies("silhouette", "BOTTOM")).toBe(true);
    expect(fieldApplies("silhouette", "JEWELRY")).toBe(false);
    expect(fieldApplies("silhouette", "BAG")).toBe(false);
  });

  it("offers size to anything worn in a size, including shoes and hats", () => {
    expect(fieldApplies("size", "SHOE")).toBe(true);
    expect(fieldApplies("size", "HAT")).toBe(true);
    expect(fieldApplies("size", "BAG")).toBe(false);
    expect(fieldApplies("size", "JEWELRY")).toBe(false);
  });

  it("hides nothing before a category is chosen", () => {
    // The new-item form starts blank and narrows as you pick.
    expect(fieldApplies("sleeveLength", null)).toBe(true);
    expect(fieldApplies("silhouette", undefined)).toBe(true);
  });
});

describe("buildAttributes", () => {
  it("keeps sleeve length and silhouette for a garment that has them", () => {
    const attributes = buildAttributes(
      input({ category: "TOP", sleeveLength: "long", silhouette: ["boxy"] }),
    );
    expect(attributes).toMatchObject({ sleeveLength: "long", silhouette: ["boxy"] });
  });

  it("drops values the category cannot have, whatever the form submitted", () => {
    // The field is hidden client-side, so anything arriving here is stale state from a
    // category change, or a hand-made request.
    const attributes = buildAttributes(
      input({ category: "BAG", sleeveLength: "long", silhouette: ["boxy"] }),
    );
    expect(attributes.sleeveLength).toBeUndefined();
    expect(attributes.silhouette).toBeUndefined();
  });

  it("keeps the fields that apply to every category", () => {
    const attributes = buildAttributes(
      input({ category: "JEWELRY", formality: "dressy", material: "gold", pattern: "solid" }),
    );
    expect(attributes).toEqual({ formality: "dressy", material: "gold", pattern: "solid" });
  });
});
