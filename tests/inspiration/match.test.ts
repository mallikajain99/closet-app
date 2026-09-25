import { describe, expect, it } from "vitest";

import { type ClosetItem, buildWishlist, matchPiece } from "@/lib/inspiration/match";

const closet: ClosetItem[] = [
  {
    id: "jeans",
    name: "Mid-wash straight jeans",
    category: "BOTTOM",
    subcategory: "jeans",
    colors: ["mid-wash blue"],
  },
  {
    id: "cream",
    name: "Oatmeal cropped knit cardigan",
    category: "OUTERWEAR",
    subcategory: "cardigan",
    colors: ["oatmeal"],
  },
  {
    id: "loafers",
    name: "Black leather bit mules",
    category: "SHOE",
    subcategory: "loafers",
    colors: ["black"],
  },
];

describe("matchPiece", () => {
  it("owns it when the kind and the colour both agree", () => {
    const result = matchPiece(
      {
        category: "BOTTOM",
        subcategory: "jeans",
        color: "blue",
        description: "mid-wash straight jeans",
      },
      closet,
    );
    expect(result.match).toBe("OWNED");
    expect(result.itemId).toBe("jeans");
  });

  it("calls the same garment in another colour CLOSE, not owned and not missing", () => {
    // The outcome the whole feature turns on. Calling this OWNED deletes a real want;
    // calling it MISSING sends her shopping for a cardigan she basically has.
    const result = matchPiece(
      {
        category: "OUTERWEAR",
        subcategory: "cardigan",
        color: "forest green",
        description: "forest green cardigan",
      },
      closet,
    );
    expect(result.match).toBe("CLOSE");
    expect(result.itemId).toBe("cream");
    expect(result.reason).toContain("something like it");
  });

  it("never matches across categories, however the words line up", () => {
    const result = matchPiece(
      {
        category: "BAG",
        subcategory: "leather bag",
        color: "black",
        description: "black leather bag",
      },
      closet,
    );
    expect(result.match).toBe("MISSING");
  });

  it("is missing when the closet has nothing of the kind", () => {
    const result = matchPiece(
      {
        category: "TOP",
        subcategory: "turtleneck",
        color: "grey",
        description: "grey turtleneck",
      },
      closet,
    );
    expect(result.match).toBe("MISSING");
    expect(result.itemId).toBeNull();
  });
});

describe("buildWishlist", () => {
  const piece = (description: string, match: "MISSING" | "OWNED" = "MISSING") => ({
    description,
    category: "TOP" as const,
    match,
    boughtAt: null,
  });

  it("ranks a piece that completes a look above one merely wanted more often", () => {
    // Leverage, not frequency: only the first kind becomes a wearable outfit the day
    // it is bought.
    const list = buildWishlist([
      { name: "Look A", pieces: [piece("white turtleneck"), piece("suede boots")] },
      { name: "Look B", pieces: [piece("white turtleneck"), piece("wool coat")] },
      { name: "Look C", pieces: [piece("red scarf"), piece("camel coat", "OWNED")] },
    ]);

    expect(list[0].description).toBe("red scarf");
    expect(list[0].unlocks).toEqual(["Look C"]);
    expect(list[1].description).toBe("white turtleneck");
    expect(list[1].wantedBy).toHaveLength(2);
  });

  it("leaves out what is already owned", () => {
    const list = buildWishlist([{ name: "Look", pieces: [piece("camel coat", "OWNED")] }]);
    expect(list).toEqual([]);
  });

  it("leaves out what has been bought", () => {
    const list = buildWishlist([
      {
        name: "Look",
        pieces: [{ ...piece("suede boots"), boughtAt: new Date("2026-09-01") }],
      },
    ]);
    expect(list).toEqual([]);
  });

  it("groups the same want across inspirations into one line", () => {
    const list = buildWishlist([
      { name: "A", pieces: [piece("White Turtleneck"), piece("boots")] },
      { name: "B", pieces: [piece("white turtleneck"), piece("coat")] },
    ]);
    const turtleneck = list.find((entry) => /turtleneck/i.test(entry.description))!;
    expect(turtleneck.wantedBy).toEqual(["A", "B"]);
  });
});

describe("OWNED needs more than kind and colour", () => {
  const dresses: ClosetItem[] = [
    {
      id: "burnout",
      name: "Dark red burnout slip maxi dress",
      category: "DRESS",
      subcategory: "maxi dress",
      colors: ["dark red"],
    },
  ];

  it("won't claim you own a different red maxi dress", () => {
    // Found by running the real reader on a real photo: a raspberry puff-sleeve *midi*
    // dress was read as "red maxi dress" and matched this one with full confidence,
    // which would have removed a genuine want from the shopping list.
    const result = matchPiece(
      { category: "DRESS", subcategory: "maxi dress", color: "red", description: "red maxi dress" },
      dresses,
    );
    expect(result.match).toBe("CLOSE");
    expect(result.itemId).toBe("burnout");
  });

  it("does claim it when something identifies that garment", () => {
    const result = matchPiece(
      {
        category: "DRESS",
        subcategory: "maxi dress",
        color: "red",
        description: "dark red burnout slip maxi dress",
      },
      dresses,
    );
    expect(result.match).toBe("OWNED");
  });
});
