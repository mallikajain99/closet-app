import Link from "next/link";

import { FilterChip } from "@/components/catalog/filter-chip";
import { OutfitFigure } from "@/components/outfits/outfit-figure";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { outfitCostPerWear, formatCents } from "@/lib/stats/cost-per-wear";
import { readSilhouette } from "@/lib/validation/item";

export const metadata = { title: "Outfits" };

export default async function OutfitsPage(props: PageProps<"/outfits">) {
  const searchParams = await props.searchParams;
  const tag = typeof searchParams.tag === "string" ? searchParams.tag.trim() : "";
  const user = await requireUser();

  // Counts come from the unfiltered set so the chips keep their numbers while filtered,
  // matching how the catalog's filters behave.
  const tagCounts = await db.tag.findMany({
    where: { userId: user.id, outfits: { some: {} } },
    orderBy: { name: "asc" },
    select: { name: true, _count: { select: { outfits: true } } },
  });

  const outfits = await db.outfit.findMany({
    where: {
      userId: user.id,
      ...(tag ? { tags: { some: { tag: { name: tag } } } } : {}),
    },
    orderBy: { updatedAt: "desc" },
    select: {
      id: true,
      name: true,
      _count: { select: { wearLogs: true } },
      tags: { select: { tag: { select: { name: true } } } },
      currentVersion: {
        select: {
          items: {
            orderBy: { order: "asc" },
            select: {
              item: {
                select: {
                  id: true,
                  name: true,
                  category: true,
                  subcategory: true,
                  attributes: true,
                  renderHeight: true,
                  renderWidth: true,
                  priceCents: true,
                  originalImageKey: true,
                  processedImageKey: true,
                  thumbnailKey: true,
                  _count: { select: { wearLogItems: true } },
                },
              },
            },
          },
        },
      },
    },
  });

  // One batched signing call for every garment on the page rather than one per outfit.
  const allItems = outfits.flatMap((outfit) =>
    (outfit.currentVersion?.items ?? []).map((link) => link.item),
  );
  const urls = await getItemImageUrls(allItems, "thumbnail");

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light tracking-tight">Outfits</h1>
          <p className="mt-1 text-meta text-ink-subtle">
            {outfits.length} {outfits.length === 1 ? "outfit" : "outfits"}
            {tag && <span className="text-ink-subtle"> tagged &ldquo;{tag}&rdquo;</span>}
          </p>
        </div>
        <Link
          href="/outfits/new"
          className="label shrink-0 bg-ink px-6 py-3 text-canvas transition-opacity hover:opacity-90"
        >
          Build an outfit
        </Link>
      </div>

      {tagCounts.length > 1 && (
        <nav aria-label="Filter by occasion" className="-mx-6 mt-6 overflow-x-auto px-6">
          <ul className="flex w-max gap-2 pb-1">
            <li>
              <FilterChip href="/outfits" label="All" active={!tag} />
            </li>
            {tagCounts.map((entry) => (
              <li key={entry.name}>
                <FilterChip
                  href={`/outfits?tag=${encodeURIComponent(entry.name)}`}
                  label={entry.name}
                  count={entry._count.outfits}
                  active={tag === entry.name}
                />
              </li>
            ))}
          </ul>
        </nav>
      )}

      {outfits.length === 0 ? (
        <div className="border-t border-line py-24 text-center">
          {tag ? (
            <>
              <p className="text-xl font-light">Nothing tagged &ldquo;{tag}&rdquo;.</p>
              <Link
                href="/outfits"
                className="label mt-4 inline-block text-ink-subtle underline underline-offset-4 hover:text-ink"
              >
                See every outfit
              </Link>
            </>
          ) : (
            <>
              <p className="text-xl font-light">No outfits yet.</p>
              <p className="mx-auto mt-3 max-w-sm text-meta leading-relaxed text-ink-muted">
                An outfit is an exact combination of pieces. Save the ones you actually
                wear and their cost-per-wear starts telling you something.
              </p>
            </>
          )}
        </div>
      ) : (
        <ul className="mt-8 grid grid-cols-2 gap-x-4 gap-y-8 border-t border-line pt-8 sm:grid-cols-3 lg:grid-cols-4">
          {outfits.map((outfit) => {
            const items = (outfit.currentVersion?.items ?? []).map((link) => link.item);
            const { costPerWearCents: cpw, hasCompletePricing } = outfitCostPerWear(
              items.map((item) => ({
                priceCents: item.priceCents,
                wearCount: item._count.wearLogItems,
              })),
            );

            return (
              <li key={outfit.id}>
                <Link href={`/outfits/${outfit.id}`} className="group block">
                  <div className="bg-surface-sunken transition-opacity group-hover:opacity-90">
                    <OutfitFigure
                      items={items.map((item) => ({
                        id: item.id,
                        name: item.name,
                        category: item.category,
                        subcategory: item.subcategory,
                        silhouette: readSilhouette(item.attributes),
                        renderHeight: item.renderHeight,
                        renderWidth: item.renderWidth,
                        imageUrl: urls.get(item.id) ?? null,
                      }))}
                      sizes="(max-width: 640px) 50vw, 240px"
                    />
                  </div>
                  <p className="mt-2 truncate text-ink">{outfit.name}</p>
                  <p className="text-meta text-ink-subtle">
                    {items.length} {items.length === 1 ? "piece" : "pieces"}
                    {outfit._count.wearLogs > 0 && ` · worn ${outfit._count.wearLogs}×`}
                  </p>
                  {cpw !== null && (
                    <p className="text-meta text-ink-muted">
                      {formatCents(cpw)}/wear
                      {/* Marked as partial rather than presented as exact — it is a
                          lower bound while any piece is unpriced. */}
                      {!hasCompletePricing && <span className="text-ink-subtle"> +</span>}
                    </p>
                  )}
                </Link>
              </li>
            );
          })}
        </ul>
      )}
    </main>
  );
}
