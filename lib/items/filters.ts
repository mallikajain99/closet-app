import { Category, type Prisma } from "@prisma/client";

/**
 * Catalog browsing state (spec §4, Phase 3).
 *
 * Every facet lives in the URL rather than in client state: the back button works, a
 * filtered view is bookmarkable and shareable, and the catalog stays a Server Component
 * with no hydration cost. That is the same reasoning as the category row in Phase 1,
 * extended to the rest of the facets.
 */
export type CatalogFilters = {
  category: Category | null;
  brand: string | null;
  color: string | null;
  formality: string | null;
  sleeve: string | null;
  q: string | null;
};

export const EMPTY_FILTERS: CatalogFilters = {
  category: null,
  brand: null,
  color: null,
  formality: null,
  sleeve: null,
  q: null,
};

/** Facets that are a plain string in the URL; `category` is validated separately. */
export const TEXT_FACETS = ["brand", "color", "formality", "sleeve"] as const;
export type TextFacet = (typeof TEXT_FACETS)[number];

type RawParams = Record<string, string | string[] | undefined>;

function one(value: string | string[] | undefined) {
  const first = Array.isArray(value) ? value[0] : value;
  const trimmed = first?.trim();
  return trimmed ? trimmed : null;
}

/**
 * Read filters from the query string.
 *
 * An unrecognised value is ignored rather than treated as an error — a stale or
 * hand-edited link should still load the catalog, just less filtered.
 */
export function parseFilters(searchParams: RawParams): CatalogFilters {
  const category = one(searchParams.category);

  return {
    category: category && category in Category ? (category as Category) : null,
    brand: one(searchParams.brand),
    color: one(searchParams.color),
    formality: one(searchParams.formality),
    sleeve: one(searchParams.sleeve),
    q: one(searchParams.q),
  };
}

export function activeFilterCount(filters: CatalogFilters) {
  return Object.values(filters).filter(Boolean).length;
}

/**
 * Prisma `where` for the current filters.
 *
 * `formality` and `sleeveLength` live inside the attributes JSON rather than in their own
 * columns, so they filter by JSON path. `colors` is a Postgres array, hence `has`.
 */
export function buildWhere(userId: string, filters: CatalogFilters): Prisma.ItemWhereInput {
  const and: Prisma.ItemWhereInput[] = [];

  if (filters.formality) {
    and.push({ attributes: { path: ["formality"], equals: filters.formality } });
  }
  if (filters.sleeve) {
    and.push({ attributes: { path: ["sleeveLength"], equals: filters.sleeve } });
  }

  if (filters.q) {
    // Brand and subcategory are searched alongside the name because that is how someone
    // actually looks for a garment — "everlane", "blazer", "poplin" are all plausible.
    const contains = { contains: filters.q, mode: "insensitive" as const };
    and.push({
      OR: [{ name: contains }, { brand: contains }, { subcategory: contains }],
    });
  }

  return {
    userId,
    ...(filters.category ? { category: filters.category } : {}),
    ...(filters.brand ? { brand: filters.brand } : {}),
    ...(filters.color ? { colors: { has: filters.color } } : {}),
    ...(and.length > 0 ? { AND: and } : {}),
  };
}

/**
 * A link that toggles one facet, preserving the others.
 *
 * Clicking an active chip clears it, so a filter can always be undone by clicking the
 * thing that set it — no separate "remove" affordance per chip.
 */
export function filterHref(
  filters: CatalogFilters,
  key: keyof CatalogFilters,
  value: string | null,
) {
  const next: CatalogFilters = { ...filters, [key]: filters[key] === value ? null : value };

  const params = new URLSearchParams();
  for (const [name, current] of Object.entries(next)) {
    if (current) params.set(name, current);
  }

  const query = params.toString();
  return query ? `/catalog?${query}` : "/catalog";
}
