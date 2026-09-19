import { describe, expect, it } from "vitest";
import type { Category } from "@prisma/client";

import { defaultOutfitName, suggestOutfitNames } from "@/lib/outfits/name";

const piece = (category: Category, subcategory: string | null, ...colors: string[]) => ({
  category,
  subcategory,
  colors,
});

describe("suggestOutfitNames", () => {
  it("names the top and bottom, which are what an outfit is pictured as", () => {
    const names = suggestOutfitNames([
      piece("BOTTOM", "jeans", "black"),
      piece("TOP", "sweater", "sage green"),
    ]);
    expect(names[0]).toBe("Sage green sweater + black jeans");
  });

  it("orders by body position regardless of selection order", () => {
    const a = suggestOutfitNames([piece("TOP", "shirt", "white"), piece("BOTTOM", "jeans", "blue")]);
    const b = suggestOutfitNames([piece("BOTTOM", "jeans", "blue"), piece("TOP", "shirt", "white")]);
    expect(a[0]).toBe(b[0]);
    expect(a[0]).toBe("White shirt + blue jeans");
  });

  it("offers a shorter variant without colours", () => {
    const names = suggestOutfitNames([
      piece("TOP", "sweater", "sage green"),
      piece("BOTTOM", "jeans", "black"),
    ]);
    expect(names).toContain("Sweater + jeans");
  });

  it("offers a longer variant including a third piece", () => {
    const names = suggestOutfitNames([
      piece("TOP", "sweater", "sage green"),
      piece("BOTTOM", "jeans", "black"),
      piece("OUTERWEAR", "coat", "brown"),
    ]);
    expect(names.some((name) => name.includes("brown coat"))).toBe(true);
  });

  it("treats a dress as the whole outfit rather than pairing it", () => {
    const names = suggestOutfitNames([
      piece("DRESS", "dress", "black"),
      piece("SHOE", "boots", "black"),
    ]);
    expect(names[0]).toBe("Black dress");
  });

  it("falls back to the category when a piece has no subcategory", () => {
    expect(suggestOutfitNames([piece("TOP", null, "red")])[0]).toBe("Red top");
  });

  it("copes with a piece that has no colour", () => {
    expect(suggestOutfitNames([piece("TOP", "shirt")])[0]).toBe("Shirt");
  });

  it("returns no duplicate suggestions for a one-piece outfit", () => {
    const names = suggestOutfitNames([piece("TOP", "shirt", "white")]);
    expect(new Set(names).size).toBe(names.length);
  });

  it("returns nothing for an empty outfit", () => {
    expect(suggestOutfitNames([])).toEqual([]);
  });
});

describe("defaultOutfitName", () => {
  it("is the first suggestion", () => {
    const items = [piece("TOP", "sweater", "grey"), piece("BOTTOM", "trousers", "black")];
    expect(defaultOutfitName(items)).toBe(suggestOutfitNames(items)[0]);
  });

  it("never returns an empty name", () => {
    expect(defaultOutfitName([])).toBe("Untitled outfit");
  });
});
