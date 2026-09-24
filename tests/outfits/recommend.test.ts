import { describe, expect, it } from "vitest";

import {
  type RecommendableItem,
  type RecommendableOutfit,
  recommend,
  seasonOf,
  suitsContext,
  suitsSeason,
  repeatPenalty,
} from "@/lib/outfits/recommend";

const NOW = new Date("2026-09-20T12:00:00Z");
const daysAgo = (n: number) => new Date(NOW.getTime() - n * 86_400_000);

const item = (over: Partial<RecommendableItem> = {}): RecommendableItem => ({
  name: "Thing",
  category: "TOP",
  subcategory: "top",
  brand: null,
  colors: [],
  seasons: [],
  formality: "casual",
  material: null,
  sleeveLength: "long",
  ...over,
});

const outfit = (over: Partial<RecommendableOutfit> = {}): RecommendableOutfit => ({
  id: crypto.randomUUID(),
  name: "An outfit",
  tags: [],
  lastWornOn: daysAgo(10),
  wearCount: 1,
  spokenFor: false,
  items: [item()],
  ...over,
});

describe("suitsContext", () => {
  it("takes the user's own tag over anything inferred", () => {
    // She said it is work; the pieces saying "casual" do not get a vote.
    const tagged = outfit({ tags: ["work"], items: [item({ formality: "casual" })] });
    expect(suitsContext(tagged, "work")).toBe(true);
  });

  it("treats a tag for one context as a statement that it is not another", () => {
    const gym = outfit({ tags: ["gym"], items: [item({ formality: "casual" })] });
    expect(suitsContext(gym, "casual")).toBe(false);
  });

  it("infers work from formality when nothing is tagged", () => {
    const smart = outfit({ items: [item({ formality: "smart" }), item({ formality: "casual" })] });
    expect(suitsContext(smart, "work")).toBe(true);
  });

  it("calls an outfit casual only when every piece is", () => {
    // One dressy piece is enough to stop it being the thing you throw on for class.
    const mixed = outfit({ items: [item({ formality: "casual" }), item({ formality: "dressy" })] });
    expect(suitsContext(mixed, "casual")).toBe(false);
  });

  it("recognises activewear by the garment, since it has no formality of its own", () => {
    const gym = outfit({
      items: [item({ subcategory: "bike shorts", brand: "Nike", formality: "casual" })],
    });
    expect(suitsContext(gym, "gym")).toBe(true);
  });

  it("does not call plain casual clothes gymwear", () => {
    expect(suitsContext(outfit(), "gym")).toBe(false);
  });
});

describe("suitsSeason", () => {
  it("rules an outfit out if any single piece is wrong for the season", () => {
    const withCoat = outfit({
      items: [item({ seasons: ["SUMMER"] }), item({ seasons: ["WINTER"] })],
    });
    expect(suitsSeason(withCoat, "SUMMER")).toBe(false);
  });

  it("treats an unrecorded season as all-season, not no-season", () => {
    // Missing data must never silently exclude an item.
    expect(suitsSeason(outfit({ items: [item({ seasons: [] })] }), "SPRING")).toBe(true);
  });

  it("won't send you out in autumn with bare arms", () => {
    // The bug this rule exists for. A t-shirt is genuinely all-season — worn alone in
    // July, under a sweater in January — so widening it let a t-shirt-and-jeans
    // outfit through the autumn filter with nothing over it.
    const tee = item({ category: "TOP", subcategory: "t-shirt", sleeveLength: "short" });
    const jeans = item({ category: "BOTTOM", subcategory: "jeans", sleeveLength: null });

    expect(suitsSeason(outfit({ items: [tee, jeans] }), "FALL")).toBe(false);
    expect(suitsSeason(outfit({ items: [tee, jeans] }), "SUMMER")).toBe(true);
  });

  it("passes the same tee once something is over it", () => {
    const tee = item({ category: "TOP", subcategory: "t-shirt", sleeveLength: "short" });
    const jeans = item({ category: "BOTTOM", subcategory: "jeans", sleeveLength: null });
    const cardigan = item({ category: "OUTERWEAR", subcategory: "cardigan" });

    expect(suitsSeason(outfit({ items: [tee, jeans, cardigan] }), "FALL")).toBe(true);
  });

  it("asks more of winter than of autumn", () => {
    const longSleeve = item({ category: "TOP", subcategory: "top", sleeveLength: "long" });
    const jeans = item({ category: "BOTTOM", subcategory: "jeans", sleeveLength: null });
    const look = outfit({ items: [longSleeve, jeans] });

    // Covered arms is enough for autumn; winter wants a knit or a coat.
    expect(suitsSeason(look, "FALL")).toBe(true);
    expect(suitsSeason(look, "WINTER")).toBe(false);

    const sweater = item({ category: "TOP", subcategory: "sweater", sleeveLength: "long" });
    expect(suitsSeason(outfit({ items: [sweater, jeans] }), "WINTER")).toBe(true);
  });

  it("measures the warmest layer, not the total", () => {
    // A tee under a coat is as warm as the coat; adding a second tee changes nothing.
    const tee = item({ category: "TOP", subcategory: "t-shirt", sleeveLength: "short" });
    const coat = item({ category: "OUTERWEAR", subcategory: "coat" });
    expect(suitsSeason(outfit({ items: [tee, tee, coat] }), "WINTER")).toBe(true);
  });
});

describe("seasonOf", () => {
  it("maps the months", () => {
    expect(seasonOf(new Date("2026-01-15"))).toBe("WINTER");
    expect(seasonOf(new Date("2026-04-15"))).toBe("SPRING");
    expect(seasonOf(new Date("2026-07-15"))).toBe("SUMMER");
    expect(seasonOf(new Date("2026-10-15"))).toBe("FALL");
    expect(seasonOf(new Date("2026-12-15"))).toBe("WINTER");
  });
});

describe("recommend", () => {
  const args = { season: "FALL" as const, now: NOW };

  it("puts a never-worn outfit ahead of a long-unworn one", () => {
    const never = outfit({ name: "Never", wearCount: 0, lastWornOn: null });
    const stale = outfit({ name: "Stale", lastWornOn: daysAgo(90) });
    const { casual } = recommend({ ...args, outfits: [stale, never] });
    expect(casual[0].outfit.name).toBe("Never");
    expect(casual[0].reason).toBe("Never worn");
  });

  it("orders the rest by how long since they were worn", () => {
    const recent = outfit({ name: "Recent", lastWornOn: daysAgo(2) });
    const older = outfit({ name: "Older", lastWornOn: daysAgo(40) });
    const { casual } = recommend({ ...args, outfits: [recent, older] });
    expect(casual.map((r) => r.outfit.name)).toEqual(["Older", "Recent"]);
  });

  it("sinks an outfit already on the calendar this week", () => {
    const planned = outfit({ name: "Planned", wearCount: 0, lastWornOn: null, spokenFor: true });
    const free = outfit({ name: "Free", lastWornOn: daysAgo(1) });
    const { casual } = recommend({ ...args, outfits: [planned, free] });
    expect(casual[0].outfit.name).toBe("Free");
  });

  it("groups by context rather than producing one ranking", () => {
    const work = outfit({ name: "Work", tags: ["work"] });
    const gym = outfit({ name: "Gym", tags: ["gym"] });
    const result = recommend({ ...args, outfits: [work, gym] });
    expect(result.work.map((r) => r.outfit.name)).toEqual(["Work"]);
    expect(result.gym.map((r) => r.outfit.name)).toEqual(["Gym"]);
    expect(result.casual).toEqual([]);
  });

  it("drops outfits that are wrong for the season", () => {
    const summer = outfit({ name: "Summer", items: [item({ seasons: ["SUMMER"] })] });
    const fall = outfit({ name: "Fall", items: [item({ seasons: ["FALL"] })] });
    const { casual } = recommend({ ...args, outfits: [summer, fall] });
    expect(casual.map((r) => r.outfit.name)).toEqual(["Fall"]);
  });

  it("lets a typed description outrank whose turn it is", () => {
    const stale = outfit({ name: "Grey sweater + jeans", lastWornOn: daysAgo(100) });
    const asked = outfit({
      name: "Red blouse + trousers",
      lastWornOn: daysAgo(1),
      items: [item({ colors: ["red"] })],
    });
    const { casual } = recommend({ ...args, outfits: [stale, asked], query: "something red" });
    expect(casual[0].outfit.name).toBe("Red blouse + trousers");
    expect(casual[0].reason).toBe("Matches what you asked for");
  });

  it("returns nothing rather than anything when a description matches nothing", () => {
    // A recommendation that ignores what was asked for is worse than an empty list.
    const { casual } = recommend({ ...args, outfits: [outfit()], query: "sequinned kimono" });
    expect(casual).toEqual([]);
  });

  it("still ranks everything when no description was typed", () => {
    const { casual } = recommend({ ...args, outfits: [outfit(), outfit()], query: "   " });
    expect(casual).toHaveLength(2);
  });

  it("skips an empty outfit", () => {
    const { casual } = recommend({ ...args, outfits: [outfit({ items: [] })] });
    expect(casual).toEqual([]);
  });
});

describe("variety", () => {
  const args = { season: "FALL" as const, now: NOW };
  const withPieces = (name: string, pieces: RecommendableItem[]) =>
    outfit({ name, items: pieces, lastWornOn: daysAgo(30) });

  const cardigan = (colour: string) =>
    item({ category: "OUTERWEAR", subcategory: "cardigan", colors: [colour] });
  const jeans = item({ category: "BOTTOM", subcategory: "jeans" });
  const shirt = item({ category: "TOP", subcategory: "shirt" });

  it("holds back a different cardigan when a cardigan was worn yesterday", () => {
    // The user's own example: a different colour is still a cardigan.
    const another = withPieces("Green cardigan look", [cardigan("green"), jeans]);
    const plain = withPieces("Shirt and jeans", [shirt, jeans]);

    const { casual } = recommend({
      ...args,
      outfits: [another, plain],
      recent: [{ category: "OUTERWEAR", subcategory: "cardigan", daysAgo: 1 }],
    });
    expect(casual[0].outfit.name).toBe("Shirt and jeans");
  });

  it("says which kind it is holding back", () => {
    const { casual } = recommend({
      ...args,
      outfits: [withPieces("Green cardigan look", [cardigan("green"), jeans])],
      recent: [{ category: "OUTERWEAR", subcategory: "cardigan", daysAgo: 1 }],
    });
    expect(casual[0].reason).toContain("cardigan worn recently");
  });

  it("barely minds the same jeans or shoes again — that is what those are for", () => {
    const look = withPieces("Jeans", [shirt, jeans]);
    for (const kind of [
      { category: "BOTTOM" as const, subcategory: "jeans", daysAgo: 1 },
    ]) {
      expect(repeatPenalty(look, [kind]).keep).toBeGreaterThan(0.9);
    }
  });

  it("outranks a never-worn cardigan outfit with a worn non-cardigan one", () => {
    // The failure that prompted the rewrite: a fixed penalty could not overcome the
    // 120 a never-worn outfit scores, so two cardigans were suggested the day after
    // wearing one. Damping is a fraction of the score, so it bites at any magnitude.
    const freshCardigan = outfit({
      name: "Never-worn cardigan",
      wearCount: 0,
      lastWornOn: null,
      items: [cardigan("navy"), jeans],
    });
    const plain = outfit({ name: "Plain", lastWornOn: daysAgo(30), items: [shirt, jeans] });

    const { casual } = recommend({
      ...args,
      outfits: [freshCardigan, plain],
      recent: [{ category: "OUTERWEAR", subcategory: "cardigan", daysAgo: 0 }],
    });
    expect(casual[0].outfit.name).toBe("Plain");
  });

  it("fades with distance, so four days ago costs less than yesterday", () => {
    const look = withPieces("Cardigan look", [cardigan("green"), jeans]);
    const yesterday = repeatPenalty(look, [
      { category: "OUTERWEAR", subcategory: "cardigan", daysAgo: 1 },
    ]).keep;
    const older = repeatPenalty(look, [
      { category: "OUTERWEAR", subcategory: "cardigan", daysAgo: 4 },
    ]).keep;

    expect(older).toBeGreaterThan(yesterday);
    expect(older).toBeLessThan(1);
  });

  it("forgets entirely past the window", () => {
    const look = withPieces("Cardigan look", [cardigan("green"), jeans]);
    const { keep } = repeatPenalty(look, [
      { category: "OUTERWEAR", subcategory: "cardigan", daysAgo: 9 },
    ]);
    expect(keep).toBe(1);
  });

  it("counts a kind once, however many of it an outfit contains", () => {
    const one = withPieces("One cardigan", [cardigan("green"), jeans]);
    const two = withPieces("Two cardigans", [cardigan("green"), cardigan("navy"), jeans]);
    const recent = [{ category: "OUTERWEAR" as const, subcategory: "cardigan", daysAgo: 1 }];

    expect(repeatPenalty(two, recent).keep).toBeCloseTo(
      repeatPenalty(one, recent).keep,
      5,
    );
  });
});
