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
  drawnWidth,
  layoutFor,
  outerness,
  paintDepth,
  slotFor,
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

  it("pulls a lone top toward the canonical shoulder width", () => {
    // Superseded "leaves a lone top at its natural size", which was the behaviour that
    // produced the complaint: with nothing to match against, a single top drew at
    // whatever width its photograph implied, and across 80 tops that ranged 2.8x.
    // Matching against other layers says nothing about how big the group should be, and
    // nothing whatsoever when the group is one garment.
    const natural = drawnWidth(wide, layoutFor(wide).height)!;
    const { placed } = composeOutfit([wide]);
    const drawn = drawnWidth(wide, placed[0].height)!;

    expect(Math.abs(drawn - 0.24)).toBeLessThan(Math.abs(natural - 0.24));
  });

  it("still respects the scale limit, so an oversized coat stays oversized", () => {
    const huge = {
      category: "OUTERWEAR" as const,
      subcategory: "coat",
      name: "Oversized wool coat",
      renderWidth: 1000,
      renderHeight: 300,
    };
    const { placed } = composeOutfit([huge]);
    expect(placed[0].height).toBeGreaterThanOrEqual(layoutFor(huge).height * 0.6 - 1e-9);
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

  it("orders outerwear, then the top over it, then the dress under both", () => {
    // Outer to inner, which in this flat lay means back to front and left to right.
    // A dress is the innermost thing here — anything worn with one goes over it — so
    // it comes last, not in the middle where the category order used to put it.
    const order = byPaintOrder([
      { category: "TOP" as Category },
      { category: "OUTERWEAR" as Category },
      { category: "DRESS" as Category },
    ]).map((item) => item.category);
    expect(order).toEqual(["OUTERWEAR", "TOP", "DRESS"]);
  });

  it("spreads three layers across the frame with the middle one centred", () => {
    const { placed } = composeOutfit([
      { category: "TOP" as const },
      { category: "OUTERWEAR" as const },
      { category: "DRESS" as const },
    ]);
    const at = (category: Category) => placed.find((p) => p.item.category === category)!.offsetX;
    expect(at("OUTERWEAR")).toBeLessThan(0);
    expect(at("TOP")).toBeCloseTo(0, 5);
    expect(at("DRESS")).toBeGreaterThan(0);
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

describe("outerness", () => {
  const top = (subcategory: string, sleeveLength: string | null = null) => ({
    category: "TOP" as const,
    subcategory,
    sleeveLength,
  });

  it("ranks garments the way they are worn, outermost first", () => {
    // The user's own order: coats, then sweaters, then long sleeves, then t-shirts.
    const ordered = [
      { category: "OUTERWEAR" as const, subcategory: "coat" },
      { category: "OUTERWEAR" as const, subcategory: "cardigan" },
      top("sweater"),
      top("blouse"),
      top("top", "long"),
      top("t-shirt"),
      top("tank top"),
    ];
    const ranks = ordered.map(outerness);
    for (let i = 1; i < ranks.length; i += 1) {
      expect(ranks[i]).toBeGreaterThan(ranks[i - 1]);
    }
  });

  it("puts a blouse under knitwear and over a tee, where a person would", () => {
    expect(outerness(top("blouse"))).toBeGreaterThan(outerness(top("sweater")));
    expect(outerness(top("blouse"))).toBeLessThan(outerness(top("t-shirt")));
  });

  it("separates two tops by sleeve when their names don't", () => {
    expect(outerness(top("top", "long"))).toBeLessThan(outerness(top("top", "sleeveless")));
  });

  it("lays two tops out in the order they are worn, not the order they were picked", () => {
    // Picked tee first, sweater second; the sweater still goes on the left.
    const { placed } = composeOutfit([top("t-shirt", "short"), top("sweater", "long")]);
    const at = (subcategory: string) =>
      placed.find((p) => p.item.subcategory === subcategory)!.offsetX;
    expect(at("sweater")).toBeLessThan(at("t-shirt"));
  });
});

describe("tights", () => {
  const tights = {
    category: "ACCESSORY" as const,
    subcategory: "tights",
    name: "Black sheer tights",
    // The real pair's proportions: a flat-laid pair of tights is about 0.27 as wide as
    // it is tall, which is the whole reason height was the wrong axis for them.
    renderWidth: 270,
    renderHeight: 1000,
  };
  const skirt = { category: "BOTTOM" as const, subcategory: "skirt", name: "Black mini skirt" };
  const dress = { category: "DRESS" as const, subcategory: "shift dress", name: "Brown shift dress" };

  it("paints them under everything on the lower body", () => {
    // The whole point. Tights are catalogued as an accessory, which is right — nobody
    // wears them alone — but that inherited the belt's paint order and drew them over
    // the skirt. On a person the skirt covers the top of them.
    expect(paintDepth(tights)).toBeLessThan(paintDepth(skirt));
    expect(paintDepth(tights)).toBeLessThan(paintDepth(dress));
  });

  it("stands on the floor and reaches up past the waist", () => {
    // Floor-anchored rather than waist-anchored, since width now sets the height and the
    // result is taller than waist-to-ankle. Hanging them from the waist would push the
    // hem through the floor; standing them on it puts the extra length up behind the
    // skirt, where their paint depth hides it.
    const { placed } = composeOutfit([tights]);
    const span = placed[0];
    expect(span.top + span.height).toBeCloseTo(FLOOR, 5);
    expect(span.top).toBeLessThan(WAIST);
  });

  it("is sized to a leg's width, not a belt's and not its photograph's", () => {
    // Sized by height they drew 0.135 wide against a 0.386 skirt — two legs occupying a
    // third of the width of the garment above them. A flat-laid pair photographs tall
    // and narrow; a pair of legs is neither.
    expect(slotFor(tights).widthTarget).toBe(0.16);
    expect(slotFor(tights).widthTarget).not.toBe(CATEGORY_SLOT.ACCESSORY.widthTarget);

    const { placed } = composeOutfit([tights]);
    const span = placed[0];
    expect(drawnWidth(span.item, span.height)).toBeCloseTo(0.16, 5);
  });

  it("leaves a belt alone", () => {
    const belt = { category: "ACCESSORY" as const, subcategory: "belt", name: "Brown belt" };
    expect(slotFor(belt).widthTarget).toBe(CATEGORY_SLOT.ACCESSORY.widthTarget);
    expect(paintDepth(belt)).toBe(CATEGORY_SLOT.ACCESSORY.z);
  });
});

describe("socks", () => {
  const socks = {
    category: "ACCESSORY" as const,
    subcategory: "socks",
    name: "Red ribbed crew socks",
    renderWidth: 540,
    renderHeight: 600,
  };
  const shoe = { category: "SHOE" as const, subcategory: "loafers", name: "Black loafers" };
  const trousers = { category: "BOTTOM" as const, subcategory: "trousers", name: "Black trousers" };

  it("paints them behind the shoe and behind the trouser hem", () => {
    // The order on a leg: the shoe covers the foot of the sock, the hem covers its cuff.
    expect(paintDepth(socks)).toBeLessThan(paintDepth(shoe));
    expect(paintDepth(socks)).toBeLessThan(paintDepth(trousers));
  });

  it("sits at the ankle, with the cuff clearing the top of a shoe", () => {
    const sock = layoutFor(socks);
    const boot = layoutFor(shoe);
    // The only part of a sock anyone sees is the band above the shoe.
    expect(sock.top).toBeLessThan(boot.top);
    expect(sock.top + sock.height).toBeGreaterThan(0.9);
  });

  it("is not sized to a belt's width", () => {
    expect(slotFor(socks).widthTarget).toBeUndefined();
  });

  it("does not catch a sock-adjacent word on another accessory", () => {
    // "Socket" and "sockets" must not match; the rule is word-bounded.
    const other = { category: "ACCESSORY" as const, subcategory: "belt", name: "Brown belt" };
    expect(slotFor(other).z).toBe(CATEGORY_SLOT.ACCESSORY.z);
  });
});

describe("ties", () => {
  const tie = {
    category: "ACCESSORY" as const,
    subcategory: "tie",
    name: "Navy striped tie",
    renderWidth: 160,
    renderHeight: 900,
  };
  const shirt = { category: "TOP" as const, subcategory: "shirt", name: "White shirt" };

  it("sits over every layered garment, unlike any other accessory", () => {
    // A belt hides under an untucked shirt; a tie never does. The check is against the
    // whole layered band rather than one garment, because `paintDepth` spreads tops and
    // outerwear across a range — a shirt resolves to 38.75, not TOP's static 30.
    const camisole = { category: "TOP" as const, subcategory: "camisole", name: "Camisole" };
    const coat = { category: "OUTERWEAR" as const, subcategory: "coat", name: "Wool coat" };
    for (const layer of [shirt, camisole, coat]) {
      expect(paintDepth(tie)).toBeGreaterThan(paintDepth(layer));
    }
  });

  it("still goes under the shoes", () => {
    const shoe = { category: "SHOE" as const, subcategory: "loafers", name: "Loafers" };
    expect(paintDepth(tie)).toBeLessThan(paintDepth(shoe));
  });

  it("hangs from the collar, not from its own height", () => {
    expect(layoutFor(tie).top).toBeCloseTo(SHOULDER, 5);
  });

  it("stops around the waist", () => {
    const { top, height } = layoutFor(tie);
    expect(top + height).toBeCloseTo(WAIST, 1);
  });
});

describe("a tie worn with layers", () => {
  const tie = { category: "ACCESSORY" as const, subcategory: "tie", name: "Navy striped tie" };
  const shirt = { category: "TOP" as const, subcategory: "shirt", name: "Blue shirt" };
  const cardigan = {
    category: "OUTERWEAR" as const,
    subcategory: "cardigan",
    name: "Green cardigan",
  };

  it("rides on the innermost layer, not the centre line", () => {
    // The spread puts the outermost garment leftmost and the innermost rightmost, so a
    // centred tie lands in the gap between the two and touches neither.
    const { placed } = composeOutfit([cardigan, shirt, tie]);
    const at = (name: string) => placed.find((p) => p.item.name === name)!;

    expect(at("Navy striped tie").offsetX).toBeCloseTo(at("Blue shirt").offsetX, 5);
    expect(at("Navy striped tie").offsetX).not.toBeCloseTo(at("Green cardigan").offsetX, 5);
  });

  it("stays centred when there is only one layer to sit on", () => {
    const { placed } = composeOutfit([shirt, tie]);
    expect(placed.find((p) => p.item.name === "Navy striped tie")!.offsetX).toBe(0);
  });

  it("leaves a belt on the centre line", () => {
    const belt = { category: "ACCESSORY" as const, subcategory: "belt", name: "Brown belt" };
    const { placed } = composeOutfit([cardigan, shirt, belt]);
    expect(placed.find((p) => p.item.name === "Brown belt")!.offsetX).toBe(0);
  });
});

describe("shoes are sized by width", () => {
  const wide = {
    category: "SHOE" as const, subcategory: "sneakers", name: "Converse low tops",
    renderWidth: 802, renderHeight: 481,
  };
  const tall = {
    category: "SHOE" as const, subcategory: "boots", name: "Black knee-high boots",
    renderWidth: 320, renderHeight: 612,
  };

  it("draws every pair the same width, whatever the photograph's shape", () => {
    // Height was the shared dimension before, and it is the wrong one: across 28 pairs
    // the drawn width ranged 3.4x, with knee-high boots a third the width of Converse
    // purely because boots are photographed tall.
    const { placed } = composeOutfit([wide, tall]);
    const widthOf = (name: string) => {
      const span = placed.find((p) => p.item.name === name)!;
      return span.height * (span.item.renderWidth! / span.item.renderHeight!);
    };
    expect(widthOf("Converse low tops")).toBeCloseTo(widthOf("Black knee-high boots"), 5);
  });

  it("lets the tall pair be taller", () => {
    const { placed } = composeOutfit([wide, tall]);
    const heightOf = (name: string) => placed.find((p) => p.item.name === name)!.height;
    expect(heightOf("Black knee-high boots")).toBeGreaterThan(heightOf("Converse low tops"));
  });

  it("keeps both pairs standing on the same line", () => {
    // Bottom-anchored: resizing must move the top edge, not the sole. Without
    // reapplying the anchor the knee-high boot grows upward from a fixed top and its
    // sole lifts two thirds of a leg off the ground.
    const soleOf = (shoe: typeof wide) => {
      const span = composeOutfit([shoe]).placed[0];
      return span.top + span.height;
    };
    expect(soleOf(tall)).toBeCloseTo(soleOf(wide), 5);
  });

  it("puts the taller pair's sole no higher than the shorter pair's", () => {
    const { placed } = composeOutfit([wide, tall]);
    const sole = (name: string) => {
      const span = placed.find((p) => p.item.name === name)!;
      return span.top + span.height;
    };
    expect(sole("Black knee-high boots")).toBeCloseTo(sole("Converse low tops"), 5);
  });
});

describe("a belt takes its width from the bottom", () => {
  const belt = {
    category: "ACCESSORY" as const, subcategory: "belt", name: "Brown leather belt",
    renderWidth: 628, renderHeight: 205,
  };
  const wideSkirt = {
    category: "BOTTOM" as const, subcategory: "skirt", name: "Black flowy mini skirt",
    renderWidth: 700, renderHeight: 490,
  };
  const narrowJeans = {
    category: "BOTTOM" as const, subcategory: "jeans", name: "Slim black jeans",
    renderWidth: 300, renderHeight: 800,
  };

  const beltWidth = (bottom: typeof wideSkirt) => {
    const { placed } = composeOutfit([bottom, belt]);
    const span = placed.find((p) => p.item.name === "Brown leather belt")!;
    return drawnWidth(span.item, span.height)!;
  };

  it("draws wider against a wider bottom", () => {
    // The fixed width it used to take was a guess made with no bottom in view: against a
    // mini skirt it came out less than half the waistband it was fastening.
    expect(beltWidth(wideSkirt)).toBeGreaterThan(beltWidth(narrowJeans));
  });

  it("stays narrower than the bottom it is worn on", () => {
    for (const bottom of [wideSkirt, narrowJeans]) {
      const { placed } = composeOutfit([bottom, belt]);
      const of = (name: string) => {
        const span = placed.find((p) => p.item.name === name)!;
        return drawnWidth(span.item, span.height)!;
      };
      expect(of("Brown leather belt")).toBeLessThan(of(bottom.name));
    }
  });

  it("falls back to its own size when there is no bottom", () => {
    const { placed } = composeOutfit([belt]);
    const span = placed[0];
    expect(drawnWidth(span.item, span.height)).toBeCloseTo(
      CATEGORY_SLOT.ACCESSORY.widthTarget!,
      5,
    );
  });
});
