import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import { deleteItem } from "@/app/(app)/catalog/actions";
import { DeleteItemButton } from "@/components/catalog/delete-item-button";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSignedImageUrl } from "@/lib/images/storage";
import { costPerWearCents, formatCents } from "@/lib/stats/cost-per-wear";
import { CATEGORY_LABELS, STATUS_LABELS, readSilhouette } from "@/lib/validation/item";

export default async function ItemDetailPage(props: PageProps<"/catalog/[itemId]">) {
  const { itemId } = await props.params;
  const user = await requireUser();

  const item = await db.item.findFirst({
    where: { id: itemId, userId: user.id },
    include: {
      tags: { include: { tag: true } },
      _count: { select: { wearLogItems: true } },
    },
  });

  if (!item) notFound();

  const imageUrl = await getSignedImageUrl(
    item.processedImageKey ?? item.originalImageKey,
  );
  const wearCount = item._count.wearLogItems;
  const cpw = costPerWearCents(item.priceCents, wearCount);
  const attributes = (item.attributes ?? {}) as Record<string, string>;

  const facts = [
    { label: "Category", value: CATEGORY_LABELS[item.category] },
    { label: "Subcategory", value: item.subcategory },
    { label: "Brand", value: item.brand },
    { label: "Size", value: item.size },
    { label: "Colors", value: item.colors.join(", ") || null },
    { label: "Sleeve", value: attributes.sleeveLength },
    { label: "Formality", value: attributes.formality },
    { label: "Material", value: attributes.material },
    { label: "Pattern", value: attributes.pattern },
    { label: "Silhouette", value: readSilhouette(item.attributes).join(", ") || null },
    {
      label: "Seasons",
      value: item.seasons.length ? item.seasons.join(", ").toLowerCase() : null,
    },
    { label: "Status", value: STATUS_LABELS[item.status] },
    {
      label: "Purchased",
      value: item.purchaseDate?.toLocaleDateString("en-US", { dateStyle: "medium" }),
    },
    { label: "Note", value: item.conditionNote },
  ].filter((fact) => Boolean(fact.value));

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href="/catalog" className="label text-ink-subtle hover:text-ink">
          ← Closet
        </Link>
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[360px_1fr]">
        <div className="relative aspect-[3/4] overflow-hidden bg-surface-sunken">
          {imageUrl ? (
            <Image
              src={imageUrl}
              alt=""
              fill
              unoptimized
              sizes="(max-width: 1024px) 100vw, 360px"
              className="object-contain"
            />
          ) : (
            <span className="label absolute inset-0 flex items-center justify-center text-ink-subtle">
              No photo
            </span>
          )}
        </div>

        <div>
          <h1 className="text-3xl font-light tracking-tight">{item.name}</h1>
          {item.brand && <p className="mt-1 text-ink-muted">{item.brand}</p>}

          <dl className="mt-8 flex gap-12 border-y border-line py-6">
            <div>
              <dt className="label text-ink-subtle">Lifetime wears</dt>
              <dd className="mt-1 text-3xl font-light tabular-nums">{wearCount}</dd>
            </div>
            <div>
              <dt className="label text-ink-subtle">Cost per wear</dt>
              <dd className="mt-1 text-3xl font-light tabular-nums">
                {formatCents(cpw)}
              </dd>
              {item.priceCents == null && (
                <p className="mt-1 text-meta text-ink-subtle">No price recorded</p>
              )}
            </div>
          </dl>

          {item.tags.length > 0 && (
            <ul className="mt-6 flex flex-wrap gap-2">
              {item.tags.map((link) => (
                <li
                  key={link.tagId}
                  className="label border border-line-strong px-3 py-1.5 text-ink-muted"
                >
                  {link.tag.name}
                </li>
              ))}
            </ul>
          )}

          <dl className="mt-8 grid gap-x-8 gap-y-3 sm:grid-cols-2">
            {facts.map((fact) => (
              <div key={fact.label} className="flex justify-between border-b border-line pb-2">
                <dt className="label text-ink-subtle">{fact.label}</dt>
                <dd className="text-meta text-ink">{fact.value}</dd>
              </div>
            ))}
          </dl>

          {item.sourceUrl && (
            <a
              href={item.sourceUrl}
              target="_blank"
              rel="noreferrer noopener"
              className="label mt-6 inline-block text-ink-subtle underline underline-offset-4 hover:text-ink"
            >
              Where it came from ↗
            </a>
          )}

          <div className="mt-10 flex items-center gap-6 border-t border-line pt-6">
            <Link
              href={`/catalog/${item.id}/edit`}
              className="label bg-ink px-6 py-3 text-canvas transition-opacity hover:opacity-90"
            >
              Edit
            </Link>
            <DeleteItemButton
              itemName={item.name}
              action={deleteItem.bind(null, item.id)}
            />
          </div>
        </div>
      </div>
    </main>
  );
}
