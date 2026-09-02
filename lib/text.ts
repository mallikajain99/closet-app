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
