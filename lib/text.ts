/**
 * Text normalization for free-text metadata (brand, size, subcategory, material…).
 *
 * The goal is one spelling per real-world value, so filtering and grouping don't split
 * "Everlane" from "everlane". Deliberately *not* done by title-casing: brand names have
 * idiosyncratic capitalisation that a formatter would destroy — COS, ba&sh, rag & bone,
 * lululemon. Instead the first spelling the user types wins, and later entries snap to it.
 */

/** Trim and collapse runs of internal whitespace. */
export function normalizeWhitespace(value: string): string {
  return value.trim().replace(/\s+/g, " ");
}

/**
 * Reuse an existing spelling when one matches case-insensitively; otherwise keep what
 * was typed. This is what makes the vocabulary converge without guessing at casing.
 */
export function canonicalize(
  value: string | null | undefined,
  existing: readonly string[],
): string | undefined {
  if (!value) return undefined;

  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return undefined;

  const match = existing.find(
    (candidate) => candidate.toLowerCase() === cleaned.toLowerCase(),
  );

  return match ?? cleaned;
}

/**
 * Sizes, with one extra rule: short all-letter sizes are uppercased.
 *
 * "s", "m", "xl", "xxs" are universally written capitalised, so this is safe and saves
 * the user from a lowercase first entry becoming the canonical spelling forever. Numeric
 * ("27", "8.5") and word sizes ("Small", "Petite") are left alone — uppercasing those
 * would give "SMALL", and "27" has no case to fix.
 */
export function normalizeSize(
  value: string | null | undefined,
  existing: readonly string[],
): string | undefined {
  const canonical = canonicalize(value, existing);
  if (!canonical) return undefined;

  if (/^[a-z]{1,3}$/i.test(canonical)) {
    const upper = canonical.toUpperCase();
    // Still prefer an existing spelling if the user already has one.
    return existing.find((c) => c.toLowerCase() === upper.toLowerCase()) ?? upper;
  }

  return canonical;
}

/**
 * Normalize an item title to sentence case, preserving brand capitalisation.
 *
 * Titles get typed inconsistently — "Cream Colorblock Crewneck Sweater" next to "Black
 * ribbed mock-neck top" — and the catalog grid shows them side by side, so the
 * inconsistency is the first thing you see. Sentence case is the choice: it reads as
 * prose, matches the restrained type in the design direction, and leaves proper nouns
 * standing out rather than competing with Title Case everywhere.
 *
 * Brands are the exception and are restored to their own spelling, because brand
 * capitalisation is idiosyncratic and not ours to correct — COS, ba&sh and lululemon
 * would all be mangled by any general rule. Multi-word brands are matched as phrases,
 * longest first, so "Banana Republic" survives intact rather than becoming two words
 * that happen to be checked separately.
 */
export function normalizeTitle(value: string, brands: readonly string[] = []): string {
  const base = normalizeWhitespace(value).toLowerCase();
  if (!base) return "";

  let result = base;

  const phrases = [...brands]
    .map((brand) => normalizeWhitespace(brand))
    .filter(Boolean)
    .sort((a, b) => b.length - a.length);

  for (const brand of phrases) {
    // Word boundaries can't be used directly: brands contain "&" and punctuation, which
    // \b treats as a boundary itself. Guard with explicit lookarounds on letters instead.
    const pattern = new RegExp(
      `(?<![\\p{L}\\d])${brand.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?![\\p{L}\\d])`,
      "giu",
    );
    result = result.replace(pattern, brand);
  }

  // Letter-shape garment terms keep their capital: the letter *is* the description, so
  // "v-neck" and "a-line" read as typos rather than as house style.
  result = result.replace(
    /(?<![\p{L}\d])([vatuy])-(neck|line|shirt|back|bar|strap|shape)(?![\p{L}])/giu,
    (_match, letter: string, word: string) => `${letter.toUpperCase()}-${word}`,
  );

  // Don't capitalise the first letter if the title opens with a brand that spells itself
  // lowercase — "ba&sh silk dress" must not become "Ba&sh silk dress". Checked after
  // substitution, so it compares against the brand's own spelling.
  const opensWithBrand = phrases.some((brand) => result.startsWith(brand));
  if (opensWithBrand) return result;

  return result.charAt(0).toUpperCase() + result.slice(1);
}
