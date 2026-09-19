import { Category } from "@prisma/client";
import Link from "next/link";

import { CategoryFilter } from "@/components/catalog/category-filter";
import { ItemCard, type ItemCardData } from "@/components/catalog/item-card";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { CATEGORY_PLURAL } from "@/lib/validation/item";

export const metadata = { title: "Closet" };

/** Ignore an unrecognised ?category= rather than erroring — a stale link should still load. */
function parseCategory(value: string | string[] | undefined): Category | null {
  if (typeof value !== "string") return null;
  return value in Category ? (value as Category) : null;
}

export default async function CatalogPage(props: PageProps<"/catalog">) {
  const searchParams = await props.searchParams;
  const active = parseCategory(searchParams.category);
  const user = await requireUser();

  const [items, grouped] = await Promise.all([
    db.item.findMany({
      where: { userId: user.id, ...(active ? { category: active } : {}) },
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
        _count: { select: { wearLogItems: true } },
      },
    }),
    // Counts come from the unfiltered set, so every chip keeps its number while filtered.
    db.item.groupBy({
      by: ["category"],
      where: { userId: user.id },
      _count: { _all: true },
    }),
  ]);

  const counts = new Map(grouped.map((row) => [row.category, row._count._all]));
  const total = grouped.reduce((sum, row) => sum + row._count._all, 0);

  // Thumbnails in the grid: 256px renders instead of full-size ones, over a grid that
  // never shows a tile wider than 240px.
  const urls = await getItemImageUrls(items, "thumbnail");

  const cards: ItemCardData[] = items.map((item) => {
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      brand: item.brand,
      priceCents: item.priceCents,
      status: item.status,
      processingStatus: item.processingStatus,
      wearCount: item._count.wearLogItems,
      imageUrl: urls.get(item.id) ?? null,
    };
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light tracking-tight">
            {active ? CATEGORY_PLURAL[active] : "Closet"}
          </h1>
          <p className="mt-1 text-meta text-ink-subtle">
            {items.length} {items.length === 1 ? "item" : "items"}
            {active && total > items.length && (
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

      <CategoryFilter counts={counts} active={active} total={total} />

      {cards.length === 0 ? (
        <div className="border-t border-line py-24 text-center">
          {active ? (
            <>
              <p className="text-xl font-light">
                Nothing in {CATEGORY_PLURAL[active].toLowerCase()} yet.
              </p>
              <Link
                href="/catalog"
                className="label mt-4 inline-block text-ink-subtle underline underline-offset-4 hover:text-ink"
              >
                See everything
              </Link>
            </>
          ) : (
            <>
              <p className="text-xl font-light">Nothing here yet.</p>
              <p className="mx-auto mt-3 max-w-sm text-meta leading-relaxed text-ink-muted">
                Add a few pieces you wear constantly first — they&rsquo;re the ones whose
                cost-per-wear gets interesting soonest.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 border-t border-line pt-8 sm:grid-cols-3 lg:grid-cols-4">
          {cards.map((item) => (
            <ItemCard key={item.id} item={item} />
          ))}
        </ul>
      )}
    </main>
  );
}
