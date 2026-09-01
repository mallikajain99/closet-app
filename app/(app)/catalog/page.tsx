import Link from "next/link";

import { ItemCard, type ItemCardData } from "@/components/catalog/item-card";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSignedImageUrls } from "@/lib/images/storage";

export const metadata = { title: "Closet" };

export default async function CatalogPage() {
  const user = await requireUser();

  const items = await db.item.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      name: true,
      category: true,
      brand: true,
      priceCents: true,
      status: true,
      originalImageKey: true,
      processedImageKey: true,
      _count: { select: { wearLogItems: true } },
    },
  });

  // One batched call rather than one per item — a few hundred round trips would
  // dominate the page render.
  const urls = await getSignedImageUrls(
    items.map((item) => item.processedImageKey ?? item.originalImageKey),
  );

  const cards: ItemCardData[] = items.map((item) => {
    const key = item.processedImageKey ?? item.originalImageKey;
    return {
      id: item.id,
      name: item.name,
      category: item.category,
      brand: item.brand,
      priceCents: item.priceCents,
      status: item.status,
      wearCount: item._count.wearLogItems,
      imageUrl: key ? (urls.get(key) ?? null) : null,
    };
  });

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-3xl font-light tracking-tight">Closet</h1>
          <p className="mt-1 text-meta text-ink-subtle">
            {items.length} {items.length === 1 ? "item" : "items"}
          </p>
        </div>
        <Link
          href="/catalog/new"
          className="label bg-ink px-6 py-3 text-canvas transition-opacity hover:opacity-90"
        >
          Add item
        </Link>
      </div>

      {cards.length === 0 ? (
        <div className="py-24 text-center">
          <p className="text-xl font-light">Nothing here yet.</p>
          <p className="mx-auto mt-3 max-w-sm text-meta leading-relaxed text-ink-muted">
            Add a few pieces you wear constantly first — they&rsquo;re the ones whose
            cost-per-wear gets interesting soonest.
          </p>
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
