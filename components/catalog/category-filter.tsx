import { FilterChip } from "@/components/catalog/filter-chip";
import { filterHref, type CatalogFilters } from "@/lib/items/filters";
import { CATEGORY_ORDER, CATEGORY_PLURAL } from "@/lib/validation/item";
import type { Category } from "@prisma/client";

/**
 * Category filter for the catalog — the primary axis, kept visually separate from the
 * finer facets below it because it is how you narrow first.
 *
 * Only categories that actually contain something are shown. A row of empty tabs on a
 * new closet would be noise, and the row grows naturally as the wardrobe fills out.
 */
export function CategoryFilter({
  counts,
  filters,
  total,
}: {
  counts: Map<Category, number>;
  filters: CatalogFilters;
  total: number;
}) {
  const present = CATEGORY_ORDER.filter((category) => (counts.get(category) ?? 0) > 0);

  // Nothing to filter between until there are at least two kinds of thing.
  if (present.length < 2) return null;

  return (
    <nav aria-label="Filter by type" className="-mx-6 mt-6 overflow-x-auto px-6">
      <ul className="flex w-max gap-2 pb-1">
        <li>
          <FilterChip
            href={filterHref(filters, "category", null)}
            label="Everything"
            count={total}
            active={filters.category === null}
          />
        </li>
        {present.map((category) => (
          <li key={category}>
            <FilterChip
              href={filterHref(filters, "category", category)}
              label={CATEGORY_PLURAL[category]}
              count={counts.get(category) ?? 0}
              active={filters.category === category}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}
