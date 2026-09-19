import { describe, expect, it } from "vitest";

import {
  EMPTY_FILTERS,
  activeFilterCount,
  filterHref,
  parseFilters,
} from "@/lib/items/filters";

describe("parseFilters", () => {
  it("reads every facet from the query string", () => {
    expect(
      parseFilters({
        category: "TOP",
        brand: "COS",
        color: "white",
        formality: "smart",
        sleeve: "long",
        q: "blazer",
      }),
    ).toEqual({
      category: "TOP",
      brand: "COS",
      color: "white",
      formality: "smart",
      sleeve: "long",
      q: "blazer",
    });
  });

  it("ignores an unrecognised category rather than erroring", () => {
    // A stale or hand-edited link should still load the catalog, just less filtered.
    expect(parseFilters({ category: "TROUSERS" }).category).toBeNull();
    expect(parseFilters({ category: "top" }).category).toBeNull();
  });

  it("takes the first value when a param is repeated", () => {
    expect(parseFilters({ brand: ["COS", "Everlane"] }).brand).toBe("COS");
  });

  it("treats blank and whitespace-only as absent", () => {
    expect(parseFilters({ q: "   " }).q).toBeNull();
    expect(parseFilters({ brand: "" }).brand).toBeNull();
    expect(parseFilters({})).toEqual(EMPTY_FILTERS);
  });

  it("trims surrounding whitespace", () => {
    expect(parseFilters({ q: "  linen " }).q).toBe("linen");
  });
});

describe("activeFilterCount", () => {
  it("counts only the facets that are set", () => {
    expect(activeFilterCount(EMPTY_FILTERS)).toBe(0);
    expect(activeFilterCount({ ...EMPTY_FILTERS, brand: "COS", q: "linen" })).toBe(2);
  });
});

describe("filterHref", () => {
  it("adds a facet while preserving the others", () => {
    const href = filterHref({ ...EMPTY_FILTERS, category: "TOP" }, "brand", "COS");
    expect(href).toBe("/catalog?category=TOP&brand=COS");
  });

  it("clears a facet when the active value is clicked again", () => {
    // Clicking an active chip undoes it, so no separate remove affordance is needed.
    const href = filterHref({ ...EMPTY_FILTERS, brand: "COS" }, "brand", "COS");
    expect(href).toBe("/catalog");
  });

  it("replaces a facet when a different value is clicked", () => {
    const href = filterHref({ ...EMPTY_FILTERS, brand: "COS" }, "brand", "Everlane");
    expect(href).toBe("/catalog?brand=Everlane");
  });

  it("returns the bare path once nothing is left", () => {
    expect(filterHref(EMPTY_FILTERS, "category", null)).toBe("/catalog");
  });

  it("drops a facet set to the empty string, which is how search clears itself", () => {
    expect(filterHref({ ...EMPTY_FILTERS, q: "linen" }, "q", "")).toBe("/catalog");
  });

  it("escapes values that would otherwise break the query string", () => {
    const href = filterHref(EMPTY_FILTERS, "brand", "H&M");
    expect(href).toBe("/catalog?brand=H%26M");
    expect(new URL(href, "https://x").searchParams.get("brand")).toBe("H&M");
  });
});
