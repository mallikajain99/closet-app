import Link from "next/link";

import { OutfitFigure, type FigureItem } from "@/components/outfits/outfit-figure";
import {
  CONTEXTS,
  CONTEXT_LABELS,
  type Context,
  type Recommendation,
} from "@/lib/outfits/recommend";
import type { Season } from "@prisma/client";

const SEASONS: Season[] = ["SPRING", "SUMMER", "FALL", "WINTER"];

/**
 * "Wear soon", grouped by the three things any given day is.
 *
 * Suggestions are on screen before anything is typed — the point is to be told what to
 * wear, not to have to ask. The description box refines what is already there rather
 * than being the way in, and it is a plain GET form so the result is a URL: a
 * particular set of suggestions can be reloaded, shared, or backed out of.
 */
export function Recommendations({
  groups,
  season,
  query,
  figureItems,
}: {
  groups: Record<Context, Recommendation[]>;
  season: Season;
  query: string;
  /** Pieces already resolved to signed URLs, keyed by outfit. */
  figureItems: Map<string, FigureItem[]>;
}) {
  const hasAny = CONTEXTS.some((context) => groups[context].length > 0);

  return (
    <section className="mt-16 border-t border-line pt-8">
      <div className="flex flex-wrap items-baseline justify-between gap-4">
        <h2 className="text-2xl font-light tracking-tight">Wear soon</h2>

        <div className="flex gap-3">
          {SEASONS.map((option) => {
            const params = new URLSearchParams();
            params.set("season", option);
            if (query) params.set("q", query);
            return (
              <Link
                key={option}
                href={`/?${params}`}
                className={`label transition-colors ${
                  option === season ? "text-ink" : "text-ink-subtle hover:text-ink"
                }`}
              >
                {option.toLowerCase()}
              </Link>
            );
          })}
        </div>
      </div>

      {/* GET, not a server action: refining a list is a navigation, and this way the
          back button undoes it and the field keeps what was typed with no client
          state at all. */}
      <form method="GET" action="/" className="mt-4 flex flex-wrap gap-3">
        <input type="hidden" name="season" value={season} />
        <input
          type="search"
          name="q"
          defaultValue={query}
          placeholder="Something warmer, or in brown…"
          aria-label="What are you looking for?"
          className="min-w-64 flex-1 border border-line-strong bg-surface px-3 py-2 text-meta text-ink focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          className="label bg-ink px-5 py-2.5 text-canvas transition-opacity hover:opacity-90"
        >
          Refine
        </button>
        {query && (
          <Link
            href={`/?season=${season}`}
            className="label self-center text-ink-subtle underline underline-offset-4 hover:text-ink"
          >
            Clear
          </Link>
        )}
      </form>

      {!hasAny && (
        <p className="mt-10 max-w-sm text-meta leading-relaxed text-ink-muted">
          {query
            ? "Nothing matches that. Try fewer words, or clear the description to see what's due a wear."
            : "No saved outfits fit this season yet."}
        </p>
      )}

      {CONTEXTS.map((context) => {
        const picks = groups[context];
        if (picks.length === 0) return null;

        return (
          <div key={context} className="mt-10">
            <p className="label text-ink-subtle">{CONTEXT_LABELS[context]}</p>

            <ul className="mt-3 grid grid-cols-5 gap-x-3 sm:gap-x-5">
              {picks.map((pick) => (
                <li key={pick.outfit.id}>
                  <Link href={`/outfits/${pick.outfit.id}`} className="group block">
                    <div className="bg-surface-sunken transition-opacity group-hover:opacity-80">
                      <OutfitFigure
                        items={figureItems.get(pick.outfit.id) ?? []}
                        sizes="(max-width: 640px) 18vw, 180px"
                      />
                    </div>
                    <p className="mt-2 truncate text-ink">{pick.outfit.name}</p>
                    <p className="text-meta text-ink-subtle">{pick.reason}</p>
                  </Link>
                </li>
              ))}
            </ul>
          </div>
        );
      })}
    </section>
  );
}
