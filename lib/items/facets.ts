import type { Category } from "@prisma/client";

import { FORMALITIES, SLEEVE_LENGTHS } from "@/lib/validation/item";

export type FacetValue = { value: string; count: number };

type FacetRow = {
  category: Category;
  brand: string | null;
  colors: string[];
  attributes: unknown;
};

/**
 * Tally the facet values present in a closet.
 *
 * Counting in memory rather than with a groupBy per facet: `colors` is a Postgres array
 * and `formality`/`sleeveLength` live inside the attributes JSON, so none of them is a
 * plain column to group by. At catalog scale one pass over the rows beats four round
 * trips, and it keeps the ordering rules below in one place.
 */
export function countFacets(rows: readonly FacetRow[]) {
  const categories = new Map<Category, number>();
  const brands = new Map<string, number>();
  const colors = new Map<string, number>();
  const formalities = new Map<string, number>();
  const sleeves = new Map<string, number>();

  const bump = <K>(map: Map<K, number>, key: K | null | undefined) => {
    if (key === null || key === undefined || key === "") return;
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const row of rows) {
    bump(categories, row.category);
    bump(brands, row.brand);
    for (const color of row.colors) bump(colors, color);

    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    const formality = attributes.formality;
    const sleeve = attributes.sleeveLength;
    if (typeof formality === "string") bump(formalities, formality);
    if (typeof sleeve === "string") bump(sleeves, sleeve);
  }

  return {
    categories,
    // Commonest first: the brands you own most of are the ones worth jumping to.
    brands: byCount(brands),
    colors: byCount(colors),
    // These two have an inherent order — casual→formal, sleeveless→long — and sorting
    // them by frequency would scramble a scale the eye expects to read in sequence.
    formalities: byVocabulary(formalities, FORMALITIES),
    sleeves: byVocabulary(sleeves, SLEEVE_LENGTHS),
  };
}

function byCount(map: Map<string, number>): FacetValue[] {
  return [...map.entries()]
    .map(([value, count]) => ({ value, count }))
    .sort((a, b) => b.count - a.count || a.value.localeCompare(b.value));
}

/** Ordered by a known vocabulary, with anything unrecognised appended alphabetically. */
function byVocabulary(
  map: Map<string, number>,
  vocabulary: readonly string[],
): FacetValue[] {
  const known = vocabulary
    .filter((value) => map.has(value))
    .map((value) => ({ value, count: map.get(value)! }));

  const extra = [...map.keys()]
    .filter((value) => !vocabulary.includes(value))
    .sort()
    .map((value) => ({ value, count: map.get(value)! }));

  return [...known, ...extra];
}
