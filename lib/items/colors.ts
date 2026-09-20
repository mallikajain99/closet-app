/**
 * Colour families for browsing (spec §4).
 *
 * Items store the colour the user actually typed — "espresso", "moss green", "oatmeal" —
 * because that is the useful description on an item page. As a *filter* it collapses:
 * 49 items produced 29 distinct colours, most appearing once, so nearly every chip
 * matched a single garment and the row was longer than the results.
 *
 * Filtering therefore happens on the family, while the specific colour is preserved
 * everywhere it is displayed. Families are matched by keyword rather than enumerated, so
 * a colour nobody has used yet still lands somewhere sensible.
 */
export type ColorFamily = {
  key: string;
  label: string;
  /** Muted to sit inside the warm neutral palette rather than shout over the garments. */
  swatch: string;
  keywords: readonly string[];
};

/**
 * Order matters — the first family whose keyword appears wins.
 *
 * Chromatic families come before neutrals so a compound name resolves to its hue: "slate
 * blue" is blue, not grey, and "moss green" is green. Without that ordering the neutral
 * keyword in a two-word colour would swallow it.
 */
export const COLOR_FAMILIES: readonly ColorFamily[] = [
  {
    key: "red",
    label: "Red",
    swatch: "#9f3441",
    keywords: ["red", "burgundy", "wine", "maroon", "crimson", "scarlet", "cherry", "oxblood"],
  },
  {
    key: "pink",
    label: "Pink",
    swatch: "#cf9aa6",
    keywords: ["pink", "rose", "blush", "fuchsia", "magenta", "coral", "salmon"],
  },
  {
    key: "orange",
    label: "Orange",
    swatch: "#bd6f3f",
    keywords: ["orange", "rust", "terracotta", "apricot", "peach", "amber", "ginger"],
  },
  {
    key: "yellow",
    label: "Yellow",
    swatch: "#d3b352",
    keywords: ["yellow", "butter", "mustard", "gold", "lemon", "ochre"],
  },
  {
    key: "green",
    label: "Green",
    swatch: "#6c7f53",
    keywords: ["green", "olive", "moss", "sage", "emerald", "khaki", "mint", "forest", "jade"],
  },
  {
    key: "blue",
    label: "Blue",
    swatch: "#5c7a9c",
    keywords: ["blue", "navy", "indigo", "denim", "teal", "cobalt", "cornflower", "sky", "aqua"],
  },
  {
    key: "purple",
    label: "Purple",
    swatch: "#7c6288",
    keywords: ["purple", "eggplant", "aubergine", "plum", "lavender", "lilac", "mauve", "violet"],
  },
  {
    key: "brown",
    label: "Brown",
    swatch: "#6b4f3a",
    keywords: ["brown", "espresso", "chocolate", "coffee", "mocha", "cocoa", "chestnut", "walnut"],
  },
  {
    key: "beige",
    label: "Beige",
    swatch: "#cbbda4",
    keywords: ["beige", "tan", "oatmeal", "taupe", "camel", "sand", "stone", "nude", "biscuit"],
  },
  {
    key: "white",
    label: "White",
    swatch: "#f4f2ee",
    keywords: ["white", "cream", "ivory", "ecru", "bone", "oyster"],
  },
  {
    key: "grey",
    label: "Grey",
    swatch: "#918d86",
    keywords: ["grey", "gray", "charcoal", "slate", "silver", "graphite", "ash"],
  },
  {
    key: "black",
    label: "Black",
    swatch: "#1c1b19",
    keywords: ["black", "jet", "onyx"],
  },
];

/**
 * Catch-all for a colour no keyword matches.
 *
 * The keyword lists are broad but the colour field is free text, so something will
 * eventually fall through. Bucketing it keeps every garment reachable by filtering —
 * a colour that matches nothing would otherwise be invisible in this row.
 */
export const OTHER_FAMILY: ColorFamily = {
  key: "other",
  label: "Other",
  swatch: "#b5b0a7",
  keywords: [],
};

const BY_KEY = new Map(
  [...COLOR_FAMILIES, OTHER_FAMILY].map((family) => [family.key, family]),
);

export const colorFamilyByKey = (key: string) => BY_KEY.get(key);

/**
 * The family a written colour belongs to, or null if nothing matches.
 *
 * Case-insensitive, which also absorbs the inconsistent capitalisation in the existing
 * data ("Cream" and "cream" are one colour).
 */
/**
 * Words that describe a garment as *many* colours rather than naming one.
 *
 * Deliberately not a colour family. "Multicolour" was one, and it never worked: a
 * family needs a swatch, and no single swatch is honest about a print — the beige it
 * ended up with made the chip read as another neutral. Being colourful is a property of
 * the garment, like being for work or for the gym, so it is a tag (`COLORFUL_TAG`) and
 * the colour field keeps only colours it can actually name.
 */
const MANY_COLOURS = ["multicolour", "multicolor", "multi", "print", "floral", "rainbow", "colourful", "colorful"];

/** The tag applied instead; `scripts/normalize-colors.ts` migrates existing items. */
export const COLORFUL_TAG = "colorful";

/** Whether a written colour is really saying "lots of colours". */
export function meansColorful(color: string): boolean {
  const value = color.trim().toLowerCase();
  return MANY_COLOURS.some((word) => value.includes(word));
}

export function colorFamily(color: string): ColorFamily | null {
  const value = color.trim().toLowerCase();
  if (!value) return null;

  return (
    COLOR_FAMILIES.find((family) =>
      family.keywords.some((keyword) => value.includes(keyword)),
    ) ?? null
  );
}
