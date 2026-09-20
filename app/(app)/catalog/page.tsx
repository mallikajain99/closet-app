import Link from "next/link";

import { CatalogSearch } from "@/components/catalog/catalog-search";
import { CategoryFilter } from "@/components/catalog/category-filter";
import { FacetFilters, type FacetGroup } from "@/components/catalog/facet-filters";
import { ItemCard, type ItemCardData } from "@/components/catalog/item-card";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { activeFilterCount, buildWhere, parseFilters } from "@/lib/items/filters";
import { countFacets } from "@/lib/items/facets";
import { CATEGORY_PLURAL } from "@/lib/validation/item";
import { happened } from "@/lib/wears/planned";

export const metadata = { title: "Closet" };

export default async function CatalogPage(props: PageProps<"/catalog">) {
  const searchParams = await props.searchParams;
  const filters = parseFilters(searchParams);
  const user = await requireUser();

  // Facet counts come from the *unfiltered* set, so every chip keeps its number while
  // filtered and the rows don't reshuffle as you narrow. One query rather than a groupBy
  // per facet: colours and the attribute fields aren't plain columns, and at catalog
  // scale counting them in memory is cheaper than four round trips.
  //
  // It runs before the item query rather than alongside it because filtering by colour
  // needs the written colours behind the chosen family, and those come from the closet's
  // own vocabulary.
  const facetRows = await db.item.findMany({
    where: { userId: user.id },
    select: { category: true, brand: true, colors: true, attributes: true },
  });

  const { categories, brands, colors, formalities, sleeves } = countFacets(facetRows);
  const total = facetRows.length;

  const colorMembers = colors.find((family) => family.value === filters.color)?.members ?? [];

  const items = await db.item.findMany({
    where: buildWhere(user.id, filters, colorMembers),
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      category: true,
      brand: true,
      priceCents: true,
      status: true,
      processingStatus: true,
      originalImageKey: true,
      processedImageKey: true,
      thumbnailKey: true,
      // Plans excluded — see lib/wears/planned.ts.
      _count: { select: { wearLogItems: { where: { wearLog: happened() } } } },
    },
  });

  const groups: FacetGroup[] = [
    { key: "brand", label: "Brand", values: brands },
    { key: "color", label: "Colour", values: colors },
    { key: "formality", label: "Formality", values: formalities },
    { key: "sleeve", label: "Sleeve", values: sleeves },
  ];

  // Thumbnails in the grid: 256px renders instead of full-size ones, over a grid that
  // never shows a tile wider than 240px.
  const urls = await getItemImageUrls(items, "thumbnail");

  const cards: ItemCardData[] = items.map((item) => ({
    id: item.id,
    name: item.name,
    category: item.category,
    brand: item.brand,
    priceCents: item.priceCents,
    status: item.status,
    processingStatus: item.processingStatus,
    wearCount: item._count.wearLogItems,
    imageUrl: urls.get(item.id) ?? null,
  }));

  const narrowed = activeFilterCount(filters) > 0;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light tracking-tight">
            {filters.category ? CATEGORY_PLURAL[filters.category] : "Closet"}
          </h1>
          <p className="mt-1 text-meta text-ink-subtle">
            {items.length} {items.length === 1 ? "item" : "items"}
            {narrowed && total > items.length && (
              <span className="text-ink-subtle"> of {total}</span>
            )}
          </p>
        </div>
        <Link
          href="/catalog/new"
          className="label shrink-0 bg-ink px-6 py-3 text-canvas transition-opacity hover:opacity-90"
        >
          Add item
        </Link>
      </div>

      <CatalogSearch filters={filters} />
      <CategoryFilter counts={categories} filters={filters} total={total} />
      <FacetFilters groups={groups} filters={filters} />

      {cards.length === 0 ? (
        <div className="py-24 text-center">
          {total === 0 ? (
            <>
              <p className="text-xl font-light">Nothing here yet.</p>
              <p className="mx-auto mt-3 max-w-sm text-meta leading-relaxed text-ink-muted">
                Add a few pieces you wear constantly first — they&rsquo;re the ones whose
                cost-per-wear gets interesting soonest.
              </p>
            </>
          ) : (
            <>
              <p className="text-xl font-light">
                {filters.q ? (
                  <>
                    Nothing matches &ldquo;{filters.q}&rdquo;.
                  </>
                ) : (
                  "Nothing matches those filters."
                )}
              </p>
              <Link
                href="/catalog"
                className="label mt-4 inline-block text-ink-subtle underline underline-offset-4 hover:text-ink"
              >
                Clear filters
              </Link>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}
