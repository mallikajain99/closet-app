import Link from "next/link";

import { OutfitFigure } from "@/components/outfits/outfit-figure";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { readSilhouette } from "@/lib/validation/item";
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

  // Keyed by ISO date so the grid can look a day up directly. The outfit is carried
  // alongside, because a day spent in a saved outfit should open that outfit rather
  // than one of the garments in it.
  type Day = { items: typeof items; outfitId: string | null };
  const byDay = new Map<string, Day>();
  for (const wear of wears) {
    const key = isoOf(wear.wornOn);
    const existing = byDay.get(key);
    byDay.set(key, {
      items: [...(existing?.items ?? []), ...shownItems(wear)],
      outfitId: existing?.outfitId ?? wear.outfitId,
    });
  }

  const weeks = buildMonthGrid(month);
  const today = isoOf(new Date(Date.UTC(
    new Date().getFullYear(),
    new Date().getMonth(),
    new Date().getDate(),
  )));

  const wornDays = byDay.size;

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="flex items-baseline justify-between gap-4">
        <div>
          <h1 className="text-3xl font-light tracking-tight">{monthLabel(month)}</h1>
          <p className="mt-1 text-meta text-ink-subtle">
            {wornDays === 0
              ? "Nothing logged yet"
              : `${wornDays} ${wornDays === 1 ? "day" : "days"} logged`}
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

          const day = byDay.get(cell.iso);
          const worn = day?.items ?? [];

          return (
            <div
              key={cell.iso}
              className={
                // Image-first: the garments fill the cell and the date recedes. Empty
                // days get no fill at all, so a sparse month reads as sparse.
                worn.length > 0
                  ? "relative aspect-square bg-surface-sunken"
                  : "relative aspect-square"
              }
            >
              <span
                className={`label absolute left-1 top-1 z-10 tabular-nums ${
                  cell.iso === today ? "text-ink" : "text-ink-subtle"
                }`}
              >
                {cell.day}
              </span>

              {worn.length > 0 && (
                <Link
                  // A saved outfit opens the outfit; a day of loose items opens the
                  // first garment.
                  href={day?.outfitId ? `/outfits/${day.outfitId}` : `/catalog/${worn[0].id}`}
                  title={worn.map((item) => item.name).join(", ")}
                  className="absolute inset-0 flex items-center justify-center"
                >
                  {/* The same composite the outfit pages use, rather than a grid of
                      thumbnails capped at four — which silently dropped pieces from a
                      bigger outfit. Two-thirds of a square cell's width makes the 2:3
                      figure exactly as tall as the cell. */}
                  <div className="h-full" style={{ width: "66.67%" }}>
                    <OutfitFigure
                      items={worn.map((item) => ({
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
                  </div>
                </Link>
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
