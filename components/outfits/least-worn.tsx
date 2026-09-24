import Link from "next/link";

import { OutfitFigure, type FigureItem } from "@/components/outfits/outfit-figure";

export type LeastWornEntry = {
  id: string;
  name: string;
  /** Null when it has never been worn, which is the case this list exists for. */
  lastWornOn: Date | null;
  items: FigureItem[];
};

const PAGE_SIZE = 5;

/**
 * How long ago, in words.
 *
 * `now` is a defaulted parameter rather than read in the component body, matching
 * `weekOf` and `hasHappened`: a clock read inside a render is not a pure function of
 * its inputs, and the lint rule enforcing that is right even in a server component.
 */
function since(date: Date | null, now: Date = new Date()): string {
  if (!date) return "Never worn";
  const days = Math.floor((now.getTime() - date.getTime()) / 86_400_000);
  if (days < 1) return "Worn today";
  if (days < 60) return `${days} days ago`;
  return `${Math.round(days / 30)} months ago`;
}

/**
 * The outfits going unworn, ranked by nothing but how long it has been.
 *
 * Deliberately separate from "Wear soon", and deliberately undamped. Suggestions apply
 * a variety penalty — a cardigan outfit sinks the day after a cardigan — which is
 * right for "what should I wear today" and wrong here: an outfit resembling something
 * worn constantly would be suppressed forever and never surface at all, which is the
 * failure the user predicted.
 *
 * Paged five at a time rather than scrolled, so the list has a bottom. A wardrobe's
 * unworn tail is long and seeing all of it at once is a reproach, not information.
 */
export function LeastWorn({
  outfits,
  page,
  season,
  query,
}: {
  outfits: LeastWornEntry[];
  page: number;
  season: string;
  query: string;
}) {
  if (outfits.length === 0) return null;

  const pages = Math.max(1, Math.ceil(outfits.length / PAGE_SIZE));
  const current = Math.min(Math.max(page, 0), pages - 1);
  const shown = outfits.slice(current * PAGE_SIZE, current * PAGE_SIZE + PAGE_SIZE);

  const linkTo = (next: number) => {
    const params = new URLSearchParams({ season });
    if (query) params.set("q", query);
    if (next > 0) params.set("unworn", String(next));
    return `/?${params}#least-worn`;
  };

  return (
    <section id="least-worn" className="mt-16 border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <div>
          <h2 className="text-2xl font-light tracking-tight">Least worn</h2>
          <p className="mt-1 text-meta text-ink-subtle">
            Longest unworn first. Set one aside from its own page if it isn&rsquo;t
            something you mean to wear soon.
          </p>
        </div>

        <div className="flex items-center gap-4">
          <p className="label text-ink-subtle">
            {current * PAGE_SIZE + 1}–{current * PAGE_SIZE + shown.length} of{" "}
            {outfits.length}
          </p>
          {current > 0 && (
            <Link href={linkTo(current - 1)} className="label text-ink-subtle hover:text-ink">
              ←
            </Link>
          )}
          {current < pages - 1 && (
            <Link href={linkTo(current + 1)} className="label text-ink-subtle hover:text-ink">
              →
            </Link>
          )}
        </div>
      </div>

      <ul className="mt-6 grid grid-cols-5 gap-x-3 sm:gap-x-5">
        {shown.map((outfit) => (
          <li key={outfit.id}>
            <Link href={`/outfits/${outfit.id}`} className="group block">
              <div className="bg-surface-sunken transition-opacity group-hover:opacity-80">
                <OutfitFigure items={outfit.items} sizes="(max-width: 640px) 18vw, 180px" />
              </div>
              <p className="mt-2 truncate text-ink">{outfit.name}</p>
              <p className="text-meta text-ink-subtle">{since(outfit.lastWornOn)}</p>
            </Link>
          </li>
        ))}
      </ul>
    </section>
  );
}
