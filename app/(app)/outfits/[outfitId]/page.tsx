import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteOutfit } from "@/app/(app)/outfits/actions";
import { DeleteItemButton } from "@/components/catalog/delete-item-button";
import { OutfitFigure } from "@/components/outfits/outfit-figure";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { costPerWearCents, formatCents, outfitCostPerWear } from "@/lib/stats/cost-per-wear";
import { CATEGORY_SLOT } from "@/lib/outfits/slots";

export default async function OutfitDetailPage(props: PageProps<"/outfits/[outfitId]">) {
  const { outfitId } = await props.params;
  const user = await requireUser();

  const outfit = await db.outfit.findFirst({
    where: { id: outfitId, userId: user.id },
    select: {
      id: true,
      name: true,
      tags: { select: { tag: { select: { name: true } } } },
      _count: { select: { wearLogs: true } },
      currentVersion: {
        select: {
          items: {
            orderBy: { order: "asc" },
            select: {
              item: {
                select: {
                  id: true,
                  name: true,
                  brand: true,
                  category: true,
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

  if (!outfit) notFound();

  const items = (outfit.currentVersion?.items ?? []).map((link) => link.item);
  const urls = await getItemImageUrls(items, "thumbnail");

  const { costPerWearCents: cpw, hasCompletePricing, pricedItemCount, totalItemCount } =
    outfitCostPerWear(
      items.map((item) => ({
        priceCents: item.priceCents,
        wearCount: item._count.wearLogItems,
      })),
    );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href="/outfits" className="label text-ink-subtle hover:text-ink">
          ← Outfits
        </Link>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[360px_1fr]">
        <div className="bg-surface-sunken lg:sticky lg:top-8 lg:self-start">
          <OutfitFigure
            items={items.map((item) => ({
              id: item.id,
              name: item.name,
              category: item.category,
              imageUrl: urls.get(item.id) ?? null,
            }))}
            sizes="360px"
          />
        </div>

        <div>
          <h1 className="text-3xl font-light tracking-tight">{outfit.name}</h1>

          <dl className="mt-8 flex gap-12 border-y border-line py-6">
            <div>
              <dt className="label text-ink-subtle">Times worn</dt>
              <dd className="mt-1 text-3xl font-light tabular-nums">
                {outfit._count.wearLogs}
              </dd>
            </div>
            <div>
              <dt className="label text-ink-subtle">Cost per wear</dt>
              <dd className="mt-1 text-3xl font-light tabular-nums">{formatCents(cpw)}</dd>
              <p className="mt-1 text-meta text-ink-subtle">
                {/* Sum of the items' own cost-per-wear, not outfit price ÷ outfit wears —
                    otherwise a new combination of well-worn pieces looks expensive. */}
                {hasCompletePricing
                  ? "Sum of each piece's cost per wear"
                  : `${pricedItemCount} of ${totalItemCount} pieces priced — a lower bound`}
              </p>
            </div>
          </dl>

          {outfit.tags.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2">
              {outfit.tags.map(({ tag }) => (
                <li
                  key={tag.name}
                  className="label border border-line-strong px-3 py-1.5 text-ink-muted"
                >
                  {tag.name}
                </li>
              ))}
            </ul>
          )}

          <p className="label mt-8 text-ink-subtle">Pieces</p>
          <ul className="mt-3 grid gap-3">
            {items.map((item) => (
              <li key={item.id}>
                <Link
                  href={`/catalog/${item.id}`}
                  className="group flex items-center gap-4 border-b border-line pb-3"
                >
                  <div className="relative size-14 shrink-0 overflow-hidden bg-surface-sunken">
                    {urls.get(item.id) && (
                      <Image
                        src={urls.get(item.id)!}
                        alt=""
                        fill
                        unoptimized
                        sizes="56px"
                        className="object-contain"
                      />
                    )}
                  </div>
                  <div className="min-w-0 flex-1">
                    <p className="truncate text-ink group-hover:underline">{item.name}</p>
                    <p className="text-meta text-ink-subtle">
                      {CATEGORY_SLOT[item.category].label}
                      {item.brand && ` · ${item.brand}`}
                    </p>
                  </div>
                  <p className="text-meta tabular-nums text-ink-muted">
                    {formatCents(costPerWearCents(item.priceCents, item._count.wearLogItems))}
                    /wear
                  </p>
                </Link>
              </li>
            ))}
          </ul>

          <div className="mt-10 flex items-center gap-6 border-t border-line pt-6">
            <DeleteItemButton
              itemName={outfit.name}
              action={deleteOutfit.bind(null, outfit.id)}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
