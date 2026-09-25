import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  deleteItem,
  keepOriginalImage,
  reprocessItem,
} from "@/app/(app)/catalog/actions";
import { addCompliment, logItemWear, removeItemWear } from "@/app/(app)/wears/actions";
import { DeleteItemButton } from "@/components/catalog/delete-item-button";
import { ImageControls } from "@/components/catalog/image-controls";
import { LogWear } from "@/components/wears/log-wear";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrl } from "@/lib/images/storage";
import { costPerWearCents, formatCents } from "@/lib/stats/cost-per-wear";
import { CATEGORY_LABELS, STATUS_LABELS, readSilhouette } from "@/lib/validation/item";
import { happened, hasHappened } from "@/lib/wears/planned";

/** Reprocessing runs via `after()` inside this request — see `catalog/new/page.tsx`. */
export const maxDuration = 60;

export default async function ItemDetailPage(props: PageProps<"/catalog/[itemId]">) {
  const { itemId } = await props.params;
  const user = await requireUser();

  const item = await db.item.findFirst({
    where: { id: itemId, userId: user.id },
    include: {
      tags: { include: { tag: true } },
      // Planned wears are excluded: a date still in the future is an intention, and
      // counting it would inflate the wear count and deflate cost-per-wear.
      _count: { select: { wearLogItems: { where: { wearLog: happened() } } } },
    },
  });

  if (!item) notFound();

  // The most recent job row carries the reason a cutout failed, so the page can say
  // more than "something went wrong".
  const [imageUrl, job, wears] = await Promise.all([
    getItemImageUrl(item),
    db.imageJob.findFirst({
      where: { subjectType: "ITEM", subjectId: item.id },
      orderBy: { createdAt: "desc" },
      select: { error: true },
    }),
    db.wearLog.findMany({
      where: { userId: user.id, items: { some: { itemId: item.id } } },
      orderBy: { wornOn: "desc" },
      take: 8,
      select: { id: true, wornOn: true, compliments: true },
    }),
  ]);

  // Dates are stored as UTC midnight (see lib/validation/wear.ts), so they must be
  // formatted in UTC too — rendering them locally would show the previous day west of
  // Greenwich.
  const dateLabel = (date: Date) =>
    date.toLocaleDateString("en-US", { dateStyle: "medium", timeZone: "UTC" });

  // "Last worn" is about the past, so it skips anything still planned — otherwise
  // planning Friday's outfit would mark the garment worn and clear its neglected flag.
  const lastWorn = wears.find((wear) => hasHappened(wear.wornOn))?.wornOn ?? null;

  const wearCount = item._count.wearLogItems;

  // Compliments on any day this garment was worn — including days it was added by
  // hand to someone else's outfit, since those write `WearLogItem` rows too.
  const complimented = await db.wearLog.aggregate({
    where: { userId: user.id, items: { some: { itemId: item.id } } },
    _sum: { compliments: true },
  });
  const compliments = complimented._sum.compliments ?? 0;
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
        <div>
          {/* Square to match the render's canvas, as in the grid — a portrait frame
              letterboxes a square image and shrinks the garment for no gain. */}
          <div className="relative aspect-square overflow-hidden bg-surface-sunken">
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

          <ImageControls
            status={item.processingStatus}
            hasPhoto={Boolean(item.originalImageKey)}
            error={job?.error ?? null}
            reprocess={reprocessItem.bind(null, item.id)}
            keepOriginal={keepOriginalImage.bind(null, item.id)}
          />
        </div>

        <div>
          <h1 className="text-3xl font-light tracking-tight">{item.name}</h1>
          {/* Jump-through: the brand is the most common reason to want "more like this". */}
          {item.brand && (
            <Link
              href={`/catalog?brand=${encodeURIComponent(item.brand)}`}
              className="mt-1 inline-block text-ink-muted underline decoration-line-strong underline-offset-4 transition-colors hover:text-ink"
            >
              {item.brand}
            </Link>
          )}

          <dl className="mt-8 flex gap-12 border-y border-line py-6">
            <div>
              <dt className="label text-ink-subtle">Lifetime wears</dt>
              <dd className="mt-1 text-3xl font-light tabular-nums">{wearCount}</dd>
              <p className="mt-1 text-meta text-ink-subtle">
                {lastWorn ? `Last worn ${dateLabel(lastWorn)}` : "Not worn yet"}
              </p>
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
            {compliments > 0 && (
              <div>
                <dt className="label text-ink-subtle">Compliments</dt>
                <dd className="mt-1 text-3xl font-light tabular-nums">♥ {compliments}</dd>
              </div>
            )}
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

          <LogWear
            today={new Date().toISOString().slice(0, 10)}
            recent={wears.map((wear) => ({
              id: wear.id,
              wornOn: wear.wornOn.toISOString().slice(0, 10),
              label: dateLabel(wear.wornOn),
              planned: !hasHappened(wear.wornOn),
              compliments: wear.compliments,
            }))}
            action={logItemWear.bind(null, item.id)}
            remove={removeItemWear.bind(null, item.id)}
            compliment={addCompliment}
          />

          <div className="mt-10 flex items-center gap-6 border-t border-line pt-6">
            {/* The usual way an outfit starts: not from an empty builder, but from one
                garment already in mind. Arriving with it picked skips the step of
                hunting it back down in a strip of every top in the closet. */}
            <Link
              href={`/outfits/new?item=${item.id}`}
              className="label bg-ink px-6 py-3 text-canvas transition-opacity hover:opacity-90"
            >
              Build an outfit
            </Link>
            <Link
              href={`/catalog/${item.id}/edit`}
              className="label text-ink-subtle transition-colors hover:text-ink"
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
