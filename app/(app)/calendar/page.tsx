import Image from "next/image";
import Link from "next/link";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
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

/** How many garments a single cell shows before summarising the rest. */
const MAX_PER_CELL = 4;

export default async function CalendarPage(props: PageProps<"/calendar">) {
  const searchParams = await props.searchParams;
  const month = parseMonth(
    typeof searchParams.month === "string" ? searchParams.month : undefined,
  );
  const user = await requireUser();

  const { from, to } = monthRange(month);
  const wears = await db.wearLog.findMany({
    where: { userId: user.id, wornOn: { gte: from, lte: to } },
    orderBy: { wornOn: "asc" },
    select: {
      id: true,
      wornOn: true,
      items: {
        select: {
          item: {
            select: {
              id: true,
              name: true,
              originalImageKey: true,
              processedImageKey: true,
              thumbnailKey: true,
            },
          },
        },
      },
    },
  });

  const items = wears.flatMap((wear) => wear.items.map((link) => link.item));
  const urls = await getItemImageUrls(items, "thumbnail");

  // Keyed by ISO date so the grid can look a day up directly.
  const byDay = new Map<string, typeof items>();
  for (const wear of wears) {
    const key = isoOf(wear.wornOn);
    byDay.set(key, [...(byDay.get(key) ?? []), ...wear.items.map((link) => link.item)]);
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

          const worn = byDay.get(cell.iso) ?? [];
          const shown = worn.slice(0, MAX_PER_CELL);

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

              {shown.length > 0 && (
                <div
                  className={`absolute inset-0 grid ${
                    shown.length === 1 ? "grid-cols-1" : "grid-cols-2"
                  }`}
                >
                  {shown.map((item) => {
                    const url = urls.get(item.id);
                    return (
                      <Link
                        key={item.id}
                        href={`/catalog/${item.id}`}
                        title={item.name}
                        className="relative overflow-hidden"
                      >
                        {url && (
                          <Image
                            src={url}
                            alt={item.name}
                            fill
                            unoptimized
                            sizes="120px"
                            className="object-contain"
                          />
                        )}
                      </Link>
                    );
                  })}
                </div>
              )}

              {worn.length > MAX_PER_CELL && (
                <span className="label absolute bottom-1 right-1 z-10 text-ink-subtle">
                  +{worn.length - MAX_PER_CELL}
                </span>
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
