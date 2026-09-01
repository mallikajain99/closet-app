import { describe, expect, it } from "vitest";

import { isSameCombination, outfitSignature } from "@/lib/outfits/signature";

const TOP = "11111111-1111-1111-1111-111111111111";
const JEANS = "22222222-2222-2222-2222-222222222222";
const BOOTS = "33333333-3333-3333-3333-333333333333";
const BLOUSE = "44444444-4444-4444-4444-444444444444";

describe("outfitSignature", () => {
  it("is independent of the order items were chosen in", () => {
    expect(outfitSignature([TOP, JEANS, BOOTS])).toBe(
      outfitSignature([BOOTS, TOP, JEANS]),
    );
  });

  it("ignores a duplicated item", () => {
    expect(outfitSignature([TOP, JEANS, TOP])).toBe(
      outfitSignature([TOP, JEANS]),
    );
  });

  it("is stable across calls", () => {
    expect(outfitSignature([TOP, JEANS])).toBe(outfitSignature([TOP, JEANS]));
  });

  it("rejects an empty outfit", () => {
    expect(() => outfitSignature([])).toThrow();
  });
});

describe("the outfit identity rule (spec §3)", () => {
  it("treats a different item set as a different outfit", () => {
    expect(outfitSignature([TOP, JEANS, BOOTS])).not.toBe(
      outfitSignature([BLOUSE, JEANS, BOOTS]),
    );
  });

  it("does NOT treat outfits sharing one piece as the same outfit", () => {
    // The same jeans under two different tops are two distinct outfits. This is the
    // rule that stops the app claiming "you keep rewearing this outfit" just because
    // one garment recurs.
    const monday = [TOP, JEANS, BOOTS];
    const tuesday = [BLOUSE, JEANS, BOOTS];

    expect(isSameCombination(monday, tuesday)).toBe(false);
  });

  it("treats a subset as a different outfit", () => {
    // Dropping the jacket makes it a different look, not the same one worn again.
    expect(isSameCombination([TOP, JEANS, BOOTS], [TOP, JEANS])).toBe(false);
  });

  it("recognises the exact same combination", () => {
    expect(isSameCombination([TOP, JEANS, BOOTS], [JEANS, BOOTS, TOP])).toBe(
      true,
    );
  });
});
