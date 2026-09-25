import Image from "next/image";
import Link from "next/link";
import { notFound } from "next/navigation";

import {
  analyseInspiration,
  deleteInspiration,
} from "@/app/(app)/inspiration/actions";
import { PieceRow } from "@/components/inspiration/piece-row";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSignedImageUrl } from "@/lib/images/storage";
import { CATEGORY_LABELS } from "@/lib/validation/item";

export const metadata = { title: "Inspiration" };

/** Re-reading runs a model inside the request, same as the item pipeline. */
export const maxDuration = 120;

export default async function InspirationDetailPage(
  props: PageProps<"/inspiration/[inspirationId]">,
) {
  const { inspirationId } = await props.params;
  const user = await requireUser();

  const inspiration = await db.inspiration.findFirst({
    where: { id: inspirationId, userId: user.id },
    select: {
      id: true,
      imageKey: true,
      sourceUrl: true,
      note: true,
      status: true,
      error: true,
      pieces: {
        orderBy: { order: "asc" },
        select: {
          id: true,
          description: true,
          category: true,
          match: true,
          boughtAt: true,
          matchedItemId: true,
          matchedItem: { select: { name: true } },
        },
      },
    },
  });

  if (!inspiration) notFound();

  const imageUrl = await getSignedImageUrl(inspiration.imageKey);
  const missing = inspiration.pieces.filter(
    (piece) => piece.match === "MISSING" && !piece.boughtAt,
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href="/inspiration" className="label text-ink-subtle hover:text-ink">
          ← Inspiration
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">
          {inspiration.note?.trim() || "Inspiration"}
        </h1>
        {inspiration.sourceUrl && (
          <a
            href={inspiration.sourceUrl}
            target="_blank"
            rel="noreferrer noopener"
            className="label mt-1 inline-block text-ink-subtle underline underline-offset-4 hover:text-ink"
          >
            Source ↗
          </a>
        )}
      </div>

      <div className="mt-10 grid gap-10 lg:grid-cols-[320px_1fr]">
        <div className="lg:sticky lg:top-8 lg:self-start">
          <div className="relative aspect-[3/4] overflow-hidden bg-surface-sunken">
            {imageUrl && (
              <Image
                src={imageUrl}
                alt=""
                fill
                unoptimized
                sizes="320px"
                className="object-cover"
              />
            )}
          </div>
        </div>

        <div>
          {inspiration.status === "PENDING" || inspiration.status === "PROCESSING" ? (
            <p className="text-meta leading-relaxed text-ink-muted">
              Reading the garments out of this photo. Refresh in a moment.
            </p>
          ) : inspiration.status === "FAILED" ? (
            <div>
              <p className="text-meta text-signal-danger">
                Couldn&rsquo;t read this one. {inspiration.error}
              </p>
              <form action={analyseInspiration.bind(null, inspiration.id)} className="mt-3">
                <button
                  type="submit"
                  className="label bg-ink px-5 py-2.5 text-canvas transition-opacity hover:opacity-90"
                >
                  Try again
                </button>
              </form>
            </div>
          ) : (
            <>
              <div className="flex flex-wrap items-baseline justify-between gap-4">
                <p className="label text-ink-subtle">
                  {inspiration.pieces.length} pieces ·{" "}
                  {missing.length === 0
                    ? "you own it all"
                    : `${missing.length} to find`}
                </p>
                <form action={analyseInspiration.bind(null, inspiration.id)}>
                  <button
                    type="submit"
                    className="label text-ink-subtle underline underline-offset-4 hover:text-ink"
                  >
                    Read again
                  </button>
                </form>
              </div>

              <p className="mt-2 text-meta leading-relaxed text-ink-muted">
                Every verdict is a guess you can correct. Correcting one also keeps it
                from being overwritten if this is read again.
              </p>

              <ul className="mt-4 border-t border-line">
                {inspiration.pieces.map((piece) => (
                  <PieceRow
                    key={piece.id}
                    piece={{
                      id: piece.id,
                      description: piece.description,
                      categoryLabel: CATEGORY_LABELS[piece.category],
                      match: piece.match,
                      matchedItemId: piece.matchedItemId,
                      matchedItemName: piece.matchedItem?.name ?? null,
                      bought: piece.boughtAt !== null,
                    }}
                  />
                ))}
              </ul>
            </>
          )}

          <form
            action={deleteInspiration.bind(null, inspiration.id)}
            className="mt-10 border-t border-line pt-6"
          >
            <button
              type="submit"
              className="label text-ink-subtle underline underline-offset-4 transition-colors hover:text-signal-danger"
            >
              Delete this inspiration
            </button>
          </form>
        </div>
      </div>
    </main>
  );
}
