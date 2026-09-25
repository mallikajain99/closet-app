import Image from "next/image";
import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSignedImageUrls } from "@/lib/images/storage";
import { buildWishlist } from "@/lib/inspiration/match";
import { CATEGORY_LABELS } from "@/lib/validation/item";

export const metadata = { title: "Inspiration" };

/**
 * Saved inspiration, and the shopping list it adds up to.
 *
 * The list leads, because it is the part you carry into a shop. The inspirations
 * underneath are the evidence for it — every line says which looks it would complete,
 * so a want can be traced back to the reason for it rather than taken on faith.
 */
export default async function InspirationPage() {
  const user = await requireUser();

  const inspirations = await db.inspiration.findMany({
    where: { userId: user.id },
    orderBy: { createdAt: "desc" },
    select: {
      id: true,
      imageKey: true,
      note: true,
      status: true,
      createdAt: true,
      pieces: {
        orderBy: { order: "asc" },
        select: { description: true, category: true, match: true, boughtAt: true },
      },
    },
  });

  const urls = await getSignedImageUrls(inspirations.map((entry) => entry.imageKey));

  const named = (entry: (typeof inspirations)[number], index: number) =>
    entry.note?.trim() || `Inspiration ${inspirations.length - index}`;

  const wishlist = buildWishlist(
    inspirations.map((entry, index) => ({ name: named(entry, index), pieces: entry.pieces })),
  );

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex flex-wrap items-baseline justify-between gap-4 border-b border-line pb-6">
        <div>
          <h1 className="text-3xl font-light tracking-tight">Inspiration</h1>
          <p className="mt-1 text-meta text-ink-subtle">
            Outfits you&rsquo;d like to wear, and what you&rsquo;d need to buy to wear them.
          </p>
        </div>
        <Link
          href="/inspiration/new"
          className="label bg-ink px-6 py-3 text-canvas transition-opacity hover:opacity-90"
        >
          Add one
        </Link>
      </div>

      {wishlist.length > 0 && (
        <section className="mt-10">
          <h2 className="text-2xl font-light tracking-tight">Shopping list</h2>
          <p className="mt-1 text-meta text-ink-subtle">
            Ranked by what each purchase would finish, not by how often it comes up.
          </p>

          <ul className="mt-4 border-t border-line">
            {wishlist.map((entry) => (
              <li
                key={`${entry.category}:${entry.description}`}
                className="flex flex-wrap items-baseline justify-between gap-x-6 gap-y-1 border-b border-line py-3"
              >
                <div>
                  <p className="text-ink">{entry.description}</p>
                  <p className="text-meta text-ink-subtle">
                    {CATEGORY_LABELS[entry.category]} ·{" "}
                    {entry.unlocks.length > 0
                      ? `the only thing missing from ${entry.unlocks.join(", ")}`
                      : `wanted by ${entry.wantedBy.join(", ")}`}
                  </p>
                </div>
                {entry.unlocks.length > 0 && (
                  <span className="label text-signal-value">
                    completes {entry.unlocks.length}
                  </span>
                )}
              </li>
            ))}
          </ul>
        </section>
      )}

      {inspirations.length === 0 ? (
        <p className="mx-auto mt-16 max-w-sm text-center text-meta leading-relaxed text-ink-muted">
          Save a photo of an outfit you like — a screenshot, a pin, a shop window — and
          the app will work out which pieces you already own.
        </p>
      ) : (
        <section className="mt-12">
          <h2 className="label text-ink-subtle">Saved</h2>
          <ul className="mt-4 grid grid-cols-2 gap-x-6 gap-y-8 sm:grid-cols-3 lg:grid-cols-4">
            {inspirations.map((entry, index) => {
              const missing = entry.pieces.filter(
                (piece) => piece.match === "MISSING" && !piece.boughtAt,
              ).length;

              return (
                <li key={entry.id}>
                  <Link href={`/inspiration/${entry.id}`} className="group block">
                    <div className="relative aspect-[3/4] overflow-hidden bg-surface-sunken transition-opacity group-hover:opacity-80">
                      {urls.get(entry.imageKey) && (
                        <Image
                          src={urls.get(entry.imageKey)!}
                          alt=""
                          fill
                          unoptimized
                          sizes="(max-width: 640px) 50vw, 240px"
                          className="object-cover"
                        />
                      )}
                    </div>
                    <p className="mt-2 truncate text-ink">{named(entry, index)}</p>
                    <p className="text-meta text-ink-subtle">
                      {entry.status === "DONE"
                        ? missing === 0
                          ? "You own it all"
                          : `${missing} to find`
                        : entry.status === "FAILED"
                          ? "Couldn't read it"
                          : "Reading…"}
                    </p>
                  </Link>
                </li>
              );
            })}
          </ul>
        </section>
      )}
    </main>
  );
}
