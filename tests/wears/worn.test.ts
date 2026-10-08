import { describe, expect, it } from "vitest";

import { wornItemIds } from "@/lib/wears/worn";

describe("wornItemIds", () => {
  const outfit = ["hat", "top", "skirt", "shoes"];

  it("records the outfit as it stands when nothing changed", () => {
    expect(wornItemIds({ outfitItemIds: outfit })).toEqual(outfit);
  });

  it("leaves out a piece that was not worn", () => {
    // The case this exists for: an outfit with a hat, worn on a day without the hat.
    expect(wornItemIds({ outfitItemIds: outfit, removed: ["hat"] })).toEqual([
      "top",
      "skirt",
      "shoes",
    ]);
  });

  it("adds a piece worn over the outfit", () => {
    expect(wornItemIds({ outfitItemIds: outfit, added: ["coat"] })).toEqual([
      ...outfit,
      "coat",
    ]);
  });

  it("handles a swap — one out, one in", () => {
    expect(
      wornItemIds({ outfitItemIds: outfit, removed: ["shoes"], added: ["boots"] }),
    ).toEqual(["hat", "top", "skirt", "boots"]);
  });

  it("does not duplicate a piece the outfit already contains", () => {
    // Adding something already in the outfit is a no-op, not an error — and the caller
    // writes one row per id.
    expect(wornItemIds({ outfitItemIds: outfit, added: ["top"] })).toEqual(outfit);
  });

  it("lets removal win when a piece is both added and removed", () => {
    // They cannot both be true of one day, and "I did not wear it" names a garment the
    // outfit already had, where an addition may be a stale click.
    expect(
      wornItemIds({ outfitItemIds: outfit, added: ["hat"], removed: ["hat"] }),
    ).not.toContain("hat");
  });

  it("can empty an outfit entirely", () => {
    expect(wornItemIds({ outfitItemIds: outfit, removed: outfit })).toEqual([]);
  });
});
