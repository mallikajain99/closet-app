import { describe, expect, it } from "vitest";
import type { Category } from "@prisma/client";

import { countFacets } from "@/lib/items/facets";

const item = (
  category: Category,
  brand: string | null,
  colors: string[],
  attributes: Record<string, unknown> = {},
) => ({ category, brand, colors, attributes });

describe("countFacets", () => {
  it("groups written colours into families and counts every one on an item", () => {
    const { colors } = countFacets([
      item("TOP", null, ["black", "espresso"]),
      item("TOP", null, ["dark brown"]),
    ]);
    expect(colors.map((c) => [c.value, c.count])).toEqual([
      ["brown", 2],
      ["black", 1],
    ]);
  });

  it("counts an item once per family however many of its colours match", () => {
    // "blue" and "light blue" is one blue garment, not two.
    const { colors } = countFacets([item("TOP", null, ["blue", "light blue"])]);
    expect(colors).toHaveLength(1);
    expect(colors[0]).toMatchObject({ value: "blue", count: 1 });
  });

  it("reports the written colours behind each family, for the filter to query", () => {
    const { colors } = countFacets([
      item("TOP", null, ["espresso"]),
      item("TOP", null, ["dark brown"]),
    ]);
    expect(colors[0].members.sort()).toEqual(["dark brown", "espresso"]);
  });

  it("keeps families in spectrum order rather than by count", () => {
    const { colors } = countFacets([
      item("TOP", null, ["black"]),
      item("TOP", null, ["black"]),
      item("TOP", null, ["black"]),
      item("TOP", null, ["red"]),
    ]);
    expect(colors.map((c) => c.value)).toEqual(["red", "black"]);
  });

  it("buckets an unrecognised colour rather than losing it", () => {
    const { colors } = countFacets([item("TOP", null, ["chartreuse-ish"])]);
    expect(colors).toHaveLength(1);
    expect(colors[0]).toMatchObject({ value: "other", count: 1 });
  });

  it("orders brands by frequency, then alphabetically to break ties", () => {
    const { brands } = countFacets([
      item("TOP", "Gap", []),
      item("TOP", "COS", []),
      item("TOP", "COS", []),
      item("TOP", "Arket", []),
    ]);
    expect(brands.map((b) => b.value)).toEqual(["COS", "Arket", "Gap"]);
  });

  it("orders formality and sleeve by their own scale, not by frequency", () => {
    // casual→formal reads as a sequence; sorting by count would scramble it.
    const { formalities, sleeves } = countFacets([
      item("TOP", null, [], { formality: "formal" }),
      item("TOP", null, [], { formality: "casual" }),
      item("TOP", null, [], { formality: "casual" }),
      item("TOP", null, [], { sleeveLength: "long" }),
      item("TOP", null, [], { sleeveLength: "sleeveless" }),
      item("TOP", null, [], { sleeveLength: "sleeveless" }),
    ]);
    expect(formalities.map((f) => f.value)).toEqual(["casual", "formal"]);
    expect(sleeves.map((s) => s.value)).toEqual(["sleeveless", "long"]);
  });

  it("appends values outside the known vocabulary rather than dropping them", () => {
    const { formalities } = countFacets([
      item("TOP", null, [], { formality: "casual" }),
      item("TOP", null, [], { formality: "black-tie" }),
    ]);
    expect(formalities.map((f) => f.value)).toEqual(["casual", "black-tie"]);
  });

  it("skips absent, blank and non-string values", () => {
    const { brands, formalities } = countFacets([
      item("TOP", null, []),
      item("TOP", "", []),
      item("TOP", "COS", [], { formality: 42 }),
    ]);
    expect(brands).toEqual([{ value: "COS", count: 1 }]);
    expect(formalities).toEqual([]);
  });

  it("tolerates a null attributes blob", () => {
    const rows = [{ category: "TOP" as Category, brand: null, colors: [], attributes: null }];
    expect(() => countFacets(rows)).not.toThrow();
    expect(countFacets(rows).formalities).toEqual([]);
  });

  it("counts categories for the primary filter row", () => {
    const { categories } = countFacets([
      item("TOP", null, []),
      item("TOP", null, []),
      item("OUTERWEAR", null, []),
    ]);
    expect(categories.get("TOP")).toBe(2);
    expect(categories.get("OUTERWEAR")).toBe(1);
  });
});
