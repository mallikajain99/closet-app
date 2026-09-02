import { describe, expect, it } from "vitest";

import { canonicalize, normalizeSize, normalizeWhitespace } from "@/lib/text";

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
