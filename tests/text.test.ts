import { describe, expect, it } from "vitest";

import { canonicalize, normalizeSize, normalizeTitle, normalizeWhitespace } from "@/lib/text";

describe("normalizeWhitespace", () => {
  it("trims and collapses internal runs", () => {
    expect(normalizeWhitespace("  rag   &  bone ")).toBe("rag & bone");
  });
});

describe("canonicalize", () => {
  it("snaps to an existing spelling regardless of case", () => {
    expect(canonicalize("everlane", ["Everlane"])).toBe("Everlane");
    expect(canonicalize("EVERLANE", ["Everlane"])).toBe("Everlane");
  });

  it("keeps unusual brand capitalisation as first typed", () => {
    // Title-casing would give "Cos" and "Ba&Sh" — both wrong.
    expect(canonicalize("cos", ["COS"])).toBe("COS");
    expect(canonicalize("BA&SH", ["ba&sh"])).toBe("ba&sh");
    expect(canonicalize("lululemon", [])).toBe("lululemon");
  });

  it("keeps a genuinely new value as typed", () => {
    expect(canonicalize("Toteme", ["Everlane", "COS"])).toBe("Toteme");
  });

  it("treats blank and whitespace-only as absent", () => {
    expect(canonicalize("", ["COS"])).toBeUndefined();
    expect(canonicalize("   ", ["COS"])).toBeUndefined();
    expect(canonicalize(null, [])).toBeUndefined();
  });
});

describe("normalizeSize", () => {
  it("uppercases short letter sizes", () => {
    expect(normalizeSize("s", [])).toBe("S");
    expect(normalizeSize("xl", [])).toBe("XL");
    expect(normalizeSize("xxs", [])).toBe("XXS");
  });

  it("leaves numeric sizes alone", () => {
    expect(normalizeSize("27", [])).toBe("27");
    expect(normalizeSize("8.5", [])).toBe("8.5");
  });

  it("does not shout word sizes", () => {
    // "Small" must not become "SMALL".
    expect(normalizeSize("Small", [])).toBe("Small");
    expect(normalizeSize("Petite", [])).toBe("Petite");
  });

  it("does not merge an abbreviation with a spelled-out size", () => {
    // "S" and "Small" are different strings the user may use deliberately. Guessing
    // they mean the same thing would silently rewrite data.
    expect(normalizeSize("s", ["Small"])).toBe("S");
  });

  it("prefers an existing spelling over the uppercase rule", () => {
    expect(normalizeSize("xl", ["Xl"])).toBe("Xl");
  });

  it("matches an existing size case-insensitively", () => {
    expect(normalizeSize("M", ["m"])).toBe("m");
  });
});

describe("normalizeTitle", () => {
  const brands = ["COS", "Banana Republic", "H&M", "Madewell", "ba&sh"];

  it("puts a title into sentence case however it was typed", () => {
    expect(normalizeTitle("Cream Colorblock Crewneck Sweater", brands)).toBe(
      "Cream colorblock crewneck sweater",
    );
    expect(normalizeTitle("black RIBBED mock-neck TOP", brands)).toBe(
      "Black ribbed mock-neck top",
    );
  });

  it("leaves a brand in its own spelling", () => {
    // Brand capitalisation is idiosyncratic and not ours to correct.
    expect(normalizeTitle("cos wool coat", brands)).toBe("COS wool coat");
    expect(normalizeTitle("BA&SH silk dress", brands)).toBe("ba&sh silk dress");
    expect(normalizeTitle("madewell brown ballet-shoes", brands)).toBe(
      "Madewell brown ballet-shoes",
    );
  });

  it("matches a multi-word brand as a phrase", () => {
    expect(normalizeTitle("BANANA REPUBLIC poplin shirt", brands)).toBe(
      "Banana Republic poplin shirt",
    );
  });

  it("matches a brand containing punctuation", () => {
    // "&" is a word boundary to \b, so these need explicit handling.
    expect(normalizeTitle("h&m linen blazer", brands)).toBe("H&M linen blazer");
  });

  it("keeps the capital in letter-shape garment terms", () => {
    // The letter is the description — "v-neck" reads as a typo.
    expect(normalizeTitle("grey ruffle v-neck blouse", brands)).toBe(
      "Grey ruffle V-neck blouse",
    );
    expect(normalizeTitle("navy a-line skirt", brands)).toBe("Navy A-line skirt");
    expect(normalizeTitle("white t-shirt", brands)).toBe("White T-shirt");
  });

  it("does not capitalise a letter that merely starts a word", () => {
    expect(normalizeTitle("vintage tan coat", brands)).toBe("Vintage tan coat");
  });

  it("collapses whitespace and survives an empty title", () => {
    expect(normalizeTitle("  black   linen  shirt ", brands)).toBe("Black linen shirt");
    expect(normalizeTitle("   ", brands)).toBe("");
  });

  it("works with no brand vocabulary at all", () => {
    expect(normalizeTitle("Black Linen Shirt")).toBe("Black linen shirt");
  });
});
