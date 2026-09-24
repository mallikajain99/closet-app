import { describe, expect, it } from "vitest";
import type { Category } from "@prisma/client";

import { CATEGORY_EXTENT } from "@/lib/images/normalize";
import {
  BUILDER_SLOTS,
  CATEGORY_SLOT,
  FLOOR,
  SHOULDER,
  WAIST,
  byPaintOrder,
  composeOutfit,
  layoutFor,
} from "@/lib/outfits/slots";


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
  it("paints the top over its outerwear, and both over the waistband", () => {
    const order = byPaintOrder([
      { category: "OUTERWEAR" as Category },
      { category: "BOTTOM" as Category },
      { category: "TOP" as Category },
    ]).map((item) => item.category);

    // Backwards as clothing, right as a flat lay: the upper layers sit side by side,
    // and the piece worn next to the skin is the one to keep legible where they meet.
    expect(order).toEqual(["BOTTOM", "OUTERWEAR", "TOP"]);
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

  it("orders dress lengths mini < midi < maxi", () => {
    const of = (sub: string) => layoutFor({ category: "DRESS", subcategory: sub }).height;
    expect(of("mini dress")).toBeLessThan(of("midi dress"));
    expect(of("midi dress")).toBeLessThan(of("maxi dress"));
  });

  it("reads a dress's length when the name never says one", () => {
    // "gown" and "sweater dress" carry no length word, so both fell to the category
    // default and rendered at the same knee length — a floor-length gown included.
    const gown = layoutFor({ category: "DRESS", subcategory: "gown" });
    const knit = layoutFor({ category: "DRESS", subcategory: "sweater dress" });
    const maxi = layoutFor({ category: "DRESS", subcategory: "maxi dress" });
    expect(gown.height).toBeCloseTo(maxi.height, 5);
    expect(knit.height).toBeLessThan(CATEGORY_SLOT.DRESS.height);
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

describe("shoe placement", () => {
  it("stands shoes under the hem rather than on the trouser leg", () => {
    // Anatomically the trouser breaks over the shoe, so a floor-anchored shoe box sits
    // mostly behind the hem. With no leg rendered behind them the shoes read as stuck
    // to mid-calf, which is what "the rendering is off" was pointing at.
    const { placed } = composeOutfit([
      { category: "TOP" as const, subcategory: "shirt" },
      { category: "BOTTOM" as const, subcategory: "jeans" },
      { category: "SHOE" as const, subcategory: "flats" },
    ]);

    const jeans = placed.find((p) => p.item.category === "BOTTOM")!;
    const shoe = placed.find((p) => p.item.category === "SHOE")!;
    const hem = jeans.top + jeans.height;

    expect(shoe.top).toBeLessThanOrEqual(hem);
    expect(hem - shoe.top).toBeLessThan(shoe.height * 0.4);
  });

  it("leaves shoes alone in a shoes-only outfit", () => {
    const { placed } = composeOutfit([{ category: "SHOE" as const }]);
    expect(placed[0].top).toBeCloseTo(FLOOR - CATEGORY_SLOT.SHOE.height, 5);
  });
});

describe("shoulder matching", () => {
  const wide = {
    category: "TOP" as const,
    subcategory: "shirt",
    renderWidth: 900,
    renderHeight: 700,
  };
  const narrow = {
    category: "OUTERWEAR" as const,
    subcategory: "cardigan",
    silhouette: ["cropped"],
    renderWidth: 420,
    renderHeight: 800,
  };
  const widthOf = (p: { item: { renderWidth: number; renderHeight: number }; height: number }) =>
    p.height * (p.item.renderWidth / p.item.renderHeight);

  it("brings a layered top and cardigan to one shoulder width", () => {
    // Heights come from the landmark table, so drawn width is whatever the photo's
    // aspect makes it — across the real closet a factor of nearly three. Worn
    // together, the narrow one looks like it belongs to someone else.
    const { placed } = composeOutfit([wide, narrow]);
    const top = placed.find((p) => p.item.category === "TOP")!;
    const outer = placed.find((p) => p.item.category === "OUTERWEAR")!;

    const before = widthOf({ item: wide, height: layoutFor(wide).height });
    const after = widthOf({ item: narrow, height: layoutFor(narrow).height });
    expect(before / after).toBeGreaterThan(2); // the mismatch being corrected

    const ratio = widthOf(top as never) / widthOf(outer as never);
    expect(ratio).toBeGreaterThan(0.9);
    expect(ratio).toBeLessThan(1.1);
  });

  it("keeps the shoulder line fixed and moves the hem", () => {
    const { placed } = composeOutfit([wide, narrow]);
    for (const p of placed) expect(p.top).toBeCloseTo(SHOULDER, 5);
  });

  it("leaves a lone top at its natural size", () => {
    const { placed } = composeOutfit([wide]);
    expect(placed[0].height).toBeCloseTo(layoutFor(wide).height, 5);
  });

  it("does nothing when a render was never measured", () => {
    const unmeasured = { category: "OUTERWEAR" as const, subcategory: "cardigan" };
    const { placed } = composeOutfit([wide, unmeasured]);
    const top = placed.find((p) => p.item.category === "TOP")!;
    expect(top.height).toBeCloseTo(layoutFor(wide).height, 5);
  });
});

describe("layer spread", () => {
  it("moves a layered top and outerwear to opposite sides", () => {
    const { placed } = composeOutfit([
      { category: "TOP" as const, subcategory: "shirt" },
      { category: "OUTERWEAR" as const, subcategory: "cardigan" },
    ]);
    const top = placed.find((p) => p.item.category === "TOP")!;
    const outer = placed.find((p) => p.item.category === "OUTERWEAR")!;

    expect(outer.offsetX).toBeLessThan(0);
    expect(top.offsetX).toBeGreaterThan(0);
    expect(top.offsetX).toBeCloseTo(-outer.offsetX, 5);
  });

  it("keeps a lone garment on the centre line", () => {
    const cases: Array<Array<{ category: Category }>> = [
      [{ category: "TOP" }],
      [{ category: "OUTERWEAR" }],
      [{ category: "TOP" }, { category: "BOTTOM" }, { category: "SHOE" }],
    ];
    for (const items of cases) {
      for (const p of composeOutfit(items).placed) expect(p.offsetX).toBe(0);
    }
  });

  it("leaves bottoms and shoes centred even when the top is spread", () => {
    const { placed } = composeOutfit([
      { category: "TOP" as const },
      { category: "OUTERWEAR" as const },
      { category: "BOTTOM" as const },
      { category: "SHOE" as const },
    ]);
    for (const p of placed) {
      if (p.item.category === "BOTTOM" || p.item.category === "SHOE") {
        expect(p.offsetX).toBe(0);
      }
    }
  });
});

describe("a top worn over a dress", () => {
  it("gives a dress its own slot so both can be chosen", () => {
    const slots = BUILDER_SLOTS.map((s) => s.slot);
    expect(new Set(slots).size).toBe(slots.length);
    const dress = BUILDER_SLOTS.find((s) => s.categories.includes("DRESS"))!;
    const top = BUILDER_SLOTS.find((s) => s.categories.includes("TOP"))!;
    expect(dress.slot).not.toBe(top.slot);
  });

  it("paints the top over the dress, and the dress over its outerwear", () => {
    const order = byPaintOrder([
      { category: "TOP" as Category },
      { category: "OUTERWEAR" as Category },
      { category: "DRESS" as Category },
    ]).map((item) => item.category);
    expect(order).toEqual(["OUTERWEAR", "DRESS", "TOP"]);
  });

  it("spreads three layers across the frame with the middle one centred", () => {
    const { placed } = composeOutfit([
      { category: "TOP" as const },
      { category: "OUTERWEAR" as const },
      { category: "DRESS" as const },
    ]);
    const at = (category: Category) => placed.find((p) => p.item.category === category)!.offsetX;
    expect(at("OUTERWEAR")).toBeLessThan(0);
    expect(at("DRESS")).toBeCloseTo(0, 5);
    expect(at("TOP")).toBeGreaterThan(0);
  });

  it("never rescales a dress to match a shoulder", () => {
    // Matching widths works by scaling, which would drag the hem with it.
    const dress = {
      category: "DRESS" as const,
      subcategory: "maxi dress",
      renderWidth: 300,
      renderHeight: 900,
    };
    const { placed } = composeOutfit([
      dress,
      { category: "OUTERWEAR" as const, subcategory: "coat", renderWidth: 900, renderHeight: 700 },
    ]);
    const placedDress = placed.find((p) => p.item.category === "DRESS")!;
    expect(placedDress.height).toBeCloseTo(layoutFor(dress).height, 5);
  });
});

describe("layering more than one of a kind", () => {
  const measured = (over: Partial<{ subcategory: string; renderWidth: number; renderHeight: number }>) => ({
    category: "TOP" as const,
    subcategory: "sweater",
    renderWidth: 600,
    renderHeight: 700,
    ...over,
  });

  it("spreads three tops across the frame rather than stacking two of them", () => {
    // "I layer sweaters" — two tops in one outfit is ordinary, and spreading one per
    // category left the second and third sitting on top of each other.
    const { placed } = composeOutfit([
      measured({ subcategory: "t-shirt" }),
      measured({ subcategory: "sweater" }),
      measured({ subcategory: "vest" }),
    ]);
    const offsets = placed.map((p) => p.offsetX).sort((a, b) => a - b);
    expect(new Set(offsets).size).toBe(3);
    expect(offsets[0]).toBeLessThan(0);
    expect(offsets[2]).toBeGreaterThan(0);
  });

  it("matches the shoulders of every layer, not just the first two", () => {
    const wide = measured({ renderWidth: 900, renderHeight: 700 });
    const narrow = measured({ renderWidth: 300, renderHeight: 800 });
    const middling = measured({ renderWidth: 600, renderHeight: 750 });

    const { placed } = composeOutfit([wide, narrow, middling]);
    const widths = placed.map(
      (p) => p.height * (p.item.renderWidth / p.item.renderHeight),
    );
    expect(Math.max(...widths) / Math.min(...widths)).toBeLessThan(1.2);
  });

  it("keeps a single top on the centre line", () => {
    const { placed } = composeOutfit([measured({})]);
    expect(placed[0].offsetX).toBe(0);
  });
});

describe("width-targeted categories", () => {
  const belt = {
    category: "ACCESSORY" as const,
    subcategory: "belt",
    // Photographed lying flat, roughly 3:1.
    renderWidth: 628,
    renderHeight: 205,
  };

  it("sizes a belt by the width it should draw, not by a guessed height", () => {
    // Sizing by height is the wrong axis for a wide flat object: a belt read as a
    // bracelet at one height and overshot the trousers at the next.
    const { placed } = composeOutfit([belt]);
    const drawn = placed[0].height * (belt.renderWidth / belt.renderHeight);
    expect(drawn).toBeCloseTo(CATEGORY_SLOT.ACCESSORY.widthTarget!, 5);
  });

  it("comes out narrower than the trousers it sits on", () => {
    const trousers = {
      category: "BOTTOM" as const,
      subcategory: "trousers",
      renderWidth: 700,
      renderHeight: 1000,
    };
    const { placed } = composeOutfit([belt, trousers]);
    const widthOf = (category: string) => {
      const p = placed.find((entry) => entry.item.category === category)!;
      return p.height * (p.item.renderWidth / p.item.renderHeight);
    };
    expect(widthOf("ACCESSORY")).toBeLessThan(widthOf("BOTTOM"));
  });

  it("falls back to the category height when the render was never measured", () => {
    const { placed } = composeOutfit([{ category: "ACCESSORY" as const, subcategory: "belt" }]);
    expect(placed[0].height).toBeCloseTo(CATEGORY_SLOT.ACCESSORY.height, 5);
  });

  it("leaves categories without a width target alone", () => {
    const { placed } = composeOutfit([
      { category: "BOTTOM" as const, subcategory: "jeans", renderWidth: 700, renderHeight: 1000 },
    ]);
    expect(placed[0].height).toBeCloseTo(CATEGORY_SLOT.BOTTOM.height, 5);
  });
});
