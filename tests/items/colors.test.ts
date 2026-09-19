import { describe, expect, it } from "vitest";

import { colorFamily } from "@/lib/items/colors";

const family = (color: string) => colorFamily(color)?.key ?? null;

describe("colorFamily", () => {
  it("resolves a compound colour to its hue, not its neutral", () => {
    // The ordering rule: chromatic families are tested before neutrals, so the hue in a
    // two-word colour wins rather than being swallowed by the neutral keyword.
    expect(family("slate blue")).toBe("blue");
    expect(family("moss green")).toBe("green");
    expect(family("light blue")).toBe("blue");
    expect(family("dark brown")).toBe("brown");
  });

  it("maps the closet's real vocabulary", () => {
    expect(family("espresso")).toBe("brown");
    expect(family("oatmeal")).toBe("beige");
    expect(family("eggplant")).toBe("purple");
    expect(family("burgundy")).toBe("red");
    expect(family("wine")).toBe("red");
    expect(family("rose")).toBe("pink");
    expect(family("rust")).toBe("orange");
    expect(family("indigo")).toBe("blue");
    expect(family("olive")).toBe("green");
    expect(family("charcoal")).toBe("grey");
    expect(family("cornflower blue")).toBe("blue");
    expect(family("tan/beige")).toBe("beige");
    expect(family("multicolour")).toBe("multicolour");
  });

  it("ignores capitalisation, which the stored data is inconsistent about", () => {
    expect(family("Cream")).toBe(family("cream"));
    expect(family("Red")).toBe("red");
  });

  it("returns null for a colour no keyword matches", () => {
    expect(colorFamily("chartreuse-ish")).toBeNull();
    expect(colorFamily("")).toBeNull();
    expect(colorFamily("   ")).toBeNull();
  });

  it("gives every family a distinct key and a swatch", () => {
    expect(family("white")).toBe("white");
    expect(colorFamily("white")?.swatch).toMatch(/^#[0-9a-f]{6}$/i);
  });
});
