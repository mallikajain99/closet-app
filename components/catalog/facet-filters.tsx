import { FilterChip } from "@/components/catalog/filter-chip";
import {
  activeFilterCount,
  filterHref,
  type CatalogFilters,
  type TextFacet,
} from "@/lib/items/filters";

export type FacetGroup = {
  key: TextFacet;
  label: string;
  values: { value: string; count: number }[];
};

/**
 * The secondary facets — brand, colour, formality, sleeve.
 *
 * Behind a disclosure rather than always open: four extra chip rows above the grid would
 * dominate a view whose whole design premise is that the clothes lead (spec §5). Native
 * `<details>` keeps that free — no client component, no hydration, and it opens itself
 * whenever a facet is already applied so an active filter is never hidden.
 *
 * A group with only one value is dropped: a filter that cannot change the result is
 * decoration.
 */
export function FacetFilters({
  groups,
  filters,
}: {
  groups: FacetGroup[];
  filters: CatalogFilters;
}) {
  const usable = groups.filter((group) => group.values.length > 1);
  if (usable.length === 0) return null;

  // The category chips are their own control, so they don't count as "refinements".
  const refinements = activeFilterCount({ ...filters, category: null, q: null });

  return (
    <details open={refinements > 0} className="mt-4 border-b border-line pb-4">
      <summary className="label cursor-pointer list-none text-ink-subtle transition-colors hover:text-ink">
        Refine
        {refinements > 0 && <span className="ml-2 text-ink">({refinements})</span>}
      </summary>

      <div className="mt-4 space-y-4">
        {usable.map((group) => (
          <div key={group.key}>
            <p className="label mb-2 text-ink-subtle">{group.label}</p>
            <ul className="flex flex-wrap gap-2">
              {group.values.map(({ value, count }) => (
                <li key={value}>
                  <FilterChip
                    href={filterHref(filters, group.key, value)}
                    label={value}
                    count={count}
                    active={filters[group.key] === value}
                  />
                </li>
              ))}
            </ul>
          </div>
        ))}
      </div>
    </details>
  );
}
