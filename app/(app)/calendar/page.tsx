import Link from "next/link";

import { OutfitFigure } from "@/components/outfits/outfit-figure";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { readSilhouette } from "@/lib/validation/item";
import { hasHappened } from "@/lib/wears/planned";
import {
  WEEKDAYS,
  buildMonthGrid,
  formatMonthKey,
  isoOf,
  monthLabel,
  monthRange,
  parseMonth,
  shiftMonth,
} from "@/lib/wears/calendar";

export const metadata = { title: "Calendar" };


export default async function CalendarPage(props: PageProps<"/calendar">) {
  const searchParams = await props.searchParams;
  const month = parseMonth(
    typeof searchParams.month === "string" ? searchParams.month : undefined,
  );
  const user = await requireUser();

  const { from, to } = monthRange(month);

  const itemFields = {
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
          originalImageKey: true,
          processedImageKey: true,
          thumbnailKey: true,
        },
      },
    },
  } as const;

  const wears = await db.wearLog.findMany({
    where: { userId: user.id, wornOn: { gte: from, lte: to } },
    orderBy: { wornOn: "asc" },
    select: {
      id: true,
      wornOn: true,
      outfitId: true,
      items: itemFields,
      // The outfit as it stands today, not the version this wear was logged against.
      // A wear keeps its own snapshot so the exact-combination stats stay honest, but
      // the cell is labelled with the outfit's name and links to the outfit — showing a
      // superseded version means the picture disagrees with where it goes. Editing an
      // outfit to add shoes was silently leaving them off every day already logged.
      outfit: {
        select: {
          versions: { where: { supersededAt: null }, select: { items: itemFields } },
        },
      },
    },
  });

  /** What to show for a wear: the live outfit if it has one, else the logged garments. */
  const shownItems = (wear: (typeof wears)[number]) =>
    (wear.outfit?.versions[0]?.items ?? wear.items).map((link) => link.item);

  const items = wears.flatMap(shownItems);
  const urls = await getItemImageUrls(items, "thumbnail");

  /**
   * Keyed by ISO date, one entry per *wear* rather than one per day.
   *
   * Two outfits in a day used to be merged into a single composite — both tops, both
   * pairs of shoes, stacked into one jumbled figure that was neither outfit, linking
   * to whichever happened to be logged first. A day can hold more than one look, so
   * the cell shows them side by side.
   */
  type Worn = { items: typeof items; outfitId: string | null; planned: boolean };
  const byDay = new Map<string, Worn[]>();
  for (const wear of wears) {
    const key = isoOf(wear.wornOn);
    byDay.set(key, [
      ...(byDay.get(key) ?? []),
      {
        items: shownItems(wear),
        outfitId: wear.outfitId,
        planned: !hasHappened(wear.wornOn),
      },
    ]);
  }

  const weeks = buildMonthGrid(month);
  const today = isoOf(new Date(Date.UTC(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate(),
  )));

  const wornDays = [...byDay.values()].filter((day) => day.some((w) => !w.planned)).length;
  const plannedDays = [...byDay.values()].filter((day) => day.every((w) => w.planned)).length;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light tracking-tight">{monthLabel(month)}</h1>
          <p className="mt-1 text-meta text-ink-subtle">
            {[
              wornDays > 0 && `${wornDays} ${wornDays === 1 ? "day" : "days"} logged`,
              plannedDays > 0 && `${plannedDays} planned`,
            ]
              .filter(Boolean)
              .join(" · ") || "Nothing logged yet"}
          </p>
        </div>

        <nav className="flex items-center gap-4">
          <Link
            href={`/calendar?month=${formatMonthKey(shiftMonth(month, -1))}`}
            className="label text-ink-subtle transition-colors hover:text-ink"
          >
            ← Earlier
          </Link>
          <Link
            href={`/calendar?month=${formatMonthKey(shiftMonth(month, 1))}`}
            className="label text-ink-subtle transition-colors hover:text-ink"
          >
            Later →
          </Link>
        </nav>
      </div>

      <div className="mt-8 grid grid-cols-7 gap-px border-t border-line pt-4">
        {WEEKDAYS.map((day) => (
          <p key={day} className="label pb-2 text-center text-ink-subtle">
            {day.slice(0, 1)}
          </p>
        ))}

        {weeks.flat().map((cell, index) => {
          if (!cell) return <div key={`pad-${index}`} aria-hidden />;

          // At most two fit side by side and stay legible; a third is counted.
          const day = byDay.get(cell.iso) ?? [];
          const shown = day.slice(0, 2);
          const extra = day.length - shown.length;
          const allPlanned = day.length > 0 && day.every((wear) => wear.planned);

          return (
            <div
              key={cell.iso}
              className={
                // Image-first: the garments fill the cell and the date recedes. Empty
                // days get no fill at all, so a sparse month reads as sparse.
                // A planned day is outlined rather than filled: it reads as pencilled
                // in, and keeps a month of intentions from looking like a month of wears.
                day.length === 0
                  ? "relative aspect-square"
                  : allPlanned
                    ? "relative aspect-square border border-dashed border-line-strong"
                    : "relative aspect-square bg-surface-sunken"
              }
            >
              <span
                className={`label absolute left-1 top-1 z-10 tabular-nums ${
                  cell.iso === today ? "text-ink" : "text-ink-subtle"
                }`}
              >
                {cell.day}
              </span>

              {/* An empty day is a way in, not just a blank: tapping it is the moment
                  the user is already thinking about that date, so it opens a picker
                  with the date fixed and only the outfit left to choose. Past days
                  work too — an empty cell is often a wear not yet remembered. */}
              {day.length === 0 && (
                <Link
                  href={`/calendar/${cell.iso}`}
                  aria-label={`Add an outfit for ${cell.iso}`}
                  className="absolute inset-0 transition-colors hover:bg-surface-sunken"
                />
              )}

              {day.length > 0 && (
                <div className="absolute inset-0 flex items-center justify-center gap-0.5">
                  {shown.map((wear, at) => (
                    <Link
                      key={wear.outfitId ?? `loose-${at}`}
                      // A saved outfit opens the outfit; a day of loose items opens
                      // the first garment.
                      href={
                        wear.outfitId
                          ? `/outfits/${wear.outfitId}`
                          : `/catalog/${wear.items[0]?.id ?? ""}`
                      }
                      title={`${wear.planned ? "Planned: " : ""}${wear.items.map((item) => item.name).join(", ")}`}
                      className="h-full min-w-0 flex-1"
                    >
                      {/* The same composite the outfit pages use, rather than a grid
                          of thumbnails capped at four, which silently dropped pieces
                          from a bigger outfit. Two side by side each keep the 2:3
                          shape; stacking them would halve the height instead and a
                          full-length look would vanish. */}
                      <OutfitFigure
                        items={wear.items.map((item) => ({
                          id: item.id,
                          name: item.name,
                          category: item.category,
                          subcategory: item.subcategory,
                          silhouette: readSilhouette(item.attributes),
                          renderHeight: item.renderHeight,
                          renderWidth: item.renderWidth,
                          imageUrl: urls.get(item.id) ?? null,
                        }))}
                        sizes="120px"
                      />
                    </Link>
                  ))}

                  {extra > 0 && (
                    <Link
                      href={`/calendar/${cell.iso}`}
                      className="label absolute bottom-1 right-1 bg-canvas/90 px-1 text-ink-subtle"
                    >
                      +{extra}
                    </Link>
                  )}
                </div>
              )}

            </div>
          );
        })}
      </div>

      {wornDays === 0 && (
        <p className="mx-auto mt-10 max-w-sm text-center text-meta leading-relaxed text-ink-muted">
          Log what you wear from any item&rsquo;s page. Past days can be added at any
          time, so a wear you remember later still counts.
        </p>
      )}
    </main>
  );
}
