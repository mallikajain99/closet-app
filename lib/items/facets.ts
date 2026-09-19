import type { Category } from "@prisma/client";

import { COLOR_FAMILIES, OTHER_FAMILY, colorFamily } from "@/lib/items/colors";
import { FORMALITIES, SLEEVE_LENGTHS } from "@/lib/validation/item";

export type FacetValue = {
  value: string;
  count: number;
  /** Shown instead of `value` when the two differ, as they do for colour families. */
  label?: string;
  swatch?: string;
};

/** A colour family plus the written colours in this closet that belong to it. */
export type ColorFacet = FacetValue & { members: string[] };

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
  const formalities = new Map<string, number>();
  const sleeves = new Map<string, number>();

  // Colour is counted per *item* per family, not per colour written on it: a garment
  // tagged "blue" and "light blue" is one blue item, not two. `members` collects the
  // written colours behind each family so the filter can query them.
  const familyCounts = new Map<string, number>();
  const familyMembers = new Map<string, Set<string>>();

  const bump = <K>(map: Map<K, number>, key: K | null | undefined) => {
    if (key === null || key === undefined || key === "") return;
    map.set(key, (map.get(key) ?? 0) + 1);
  };

  for (const row of rows) {
    bump(categories, row.category);
    bump(brands, row.brand);

    const seen = new Set<string>();
    for (const color of row.colors) {
      if (!color?.trim()) continue;
      const key = (colorFamily(color) ?? OTHER_FAMILY).key;
      if (!familyMembers.has(key)) familyMembers.set(key, new Set());
      familyMembers.get(key)!.add(color);
      seen.add(key);
    }
    for (const key of seen) bump(familyCounts, key);

    const attributes = (row.attributes ?? {}) as Record<string, unknown>;
    const formality = attributes.formality;
    const sleeve = attributes.sleeveLength;
    if (typeof formality === "string") bump(formalities, formality);
    if (typeof sleeve === "string") bump(sleeves, sleeve);
  }

  const colors: ColorFacet[] = [...COLOR_FAMILIES, OTHER_FAMILY]
    .filter((family) => familyCounts.has(family.key))
    .map((family) => ({
      value: family.key,
      label: family.label,
      swatch: family.swatch,
      count: familyCounts.get(family.key)!,
      members: [...familyMembers.get(family.key)!],
    }));

  return {
    categories,
    // Commonest first: the brands you own most of are the ones worth jumping to.
    brands: byCount(brands),
    // Colour keeps the family order from COLOR_FAMILIES rather than sorting by count —
    // the row reads as a spectrum, with the neutrals grouped at the end.
    colors,
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
