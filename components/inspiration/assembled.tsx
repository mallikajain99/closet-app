import { OutfitFigure, type FigureItem } from "@/components/outfits/outfit-figure";
import { CATEGORY_LABELS } from "@/lib/validation/item";
import type { Category } from "@prisma/client";

export type Gap = { description: string; category: Category; bought: boolean };

/**
 * The inspiration rebuilt out of the closet, with the holes left visible.
 *
 * Two lists of words — "you have these, you need those" — is accurate and tells you
 * nothing about whether the result is worth assembling. Drawing the pieces she owns as
 * an outfit answers the question the inspiration actually raises: how close am I, and
 * is the near-miss any good?
 *
 * The gaps are drawn as empty slots beside it rather than omitted, because an outfit
 * missing its shoes should look like an outfit missing its shoes, not like a complete
 * one that happens to be barefoot.
 */
export function Assembled({ owned, gaps }: { owned: FigureItem[]; gaps: Gap[] }) {
  if (owned.length === 0 && gaps.length === 0) return null;

  const outstanding = gaps.filter((gap) => !gap.bought);

  return (
    <section className="mt-8 border-t border-line pt-6">
      <p className="label text-ink-subtle">From your closet</p>
      <p className="mt-1 text-meta leading-relaxed text-ink-muted">
        {owned.length === 0
          ? "Nothing in this one is in your closet yet."
          : outstanding.length === 0
            ? "You can wear this today."
            : `${owned.length} of ${owned.length + outstanding.length} pieces.`}
      </p>

      <div className="mt-4 flex flex-wrap items-start gap-6">
        {owned.length > 0 && (
          <div className="w-40 shrink-0 bg-surface-sunken">
            <OutfitFigure items={owned} sizes="160px" />
          </div>
        )}

        {outstanding.length > 0 && (
          <ul className="flex flex-wrap gap-3">
            {outstanding.map((gap) => (
              <li key={`${gap.category}:${gap.description}`}>
                {/* Same 2:3 as a garment in the figure, so a gap reads as a
                    garment-shaped hole rather than as a caption. */}
                <div className="flex h-40 w-[6.6rem] flex-col items-center justify-center border border-dashed border-line-strong px-2 text-center">
                  <span className="label text-ink-subtle">
                    {CATEGORY_LABELS[gap.category]}
                  </span>
                  <span className="mt-1 text-meta leading-tight text-ink-muted">
                    {gap.description}
                  </span>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}
