/**
 * Month-grid maths for the wear calendar.
 *
 * Deliberately UTC throughout, and separate from `lib/stats/wear-windows.ts`, which is
 * local-time by design because stats windows follow the user's own calendar. Wear dates
 * are stored as UTC midnight in a `@db.Date` column, so laying them out with local-time
 * arithmetic puts the 1st of a month in the previous month's last cell for anyone west
 * of Greenwich.
 */

export type MonthKey = { year: number; month: number };

/** A cell in the grid. `null` where the week runs outside the month. */
export type DayCell = { iso: string; day: number } | null;

const MONTH_PATTERN = /^(\d{4})-(\d{2})$/;

/** Reads `?month=YYYY-MM`, falling back to the month containing `now`. */
export function parseMonth(value: string | undefined, now: Date = new Date()): MonthKey {
  const match = value ? MONTH_PATTERN.exec(value.trim()) : null;
  if (match) {
    const year = Number(match[1]);
    const month = Number(match[2]);
    if (month >= 1 && month <= 12) return { year, month };
  }
  return { year: now.getFullYear(), month: now.getMonth() + 1 };
}

export function formatMonthKey({ year, month }: MonthKey): string {
  return `${year}-${String(month).padStart(2, "0")}`;
}

/** Half-open range covering the month, for querying `wornOn`. */
export function monthRange({ year, month }: MonthKey): { from: Date; to: Date } {
  return {
    from: new Date(Date.UTC(year, month - 1, 1)),
    // Day 0 of the next month is this month's last day, which handles length and leap years.
    to: new Date(Date.UTC(year, month, 0, 23, 59, 59, 999)),
  };
}

export function shiftMonth({ year, month }: MonthKey, by: number): MonthKey {
  const date = new Date(Date.UTC(year, month - 1 + by, 1));
  return { year: date.getUTCFullYear(), month: date.getUTCMonth() + 1 };
}

export function monthLabel({ year, month }: MonthKey): string {
  return new Date(Date.UTC(year, month - 1, 1)).toLocaleDateString("en-US", {
    month: "long",
    year: "numeric",
    timeZone: "UTC",
  });
}

/** Sunday-first, matching the weekday header the page renders. */
export const WEEKDAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"] as const;

/**
 * The month as weeks of seven cells, padded with nulls.
 *
 * Padding rather than bleeding in adjacent months' days: the design direction says empty
 * days stay empty, and a grid speckled with other months' numbers reads as noise when
 * the cells are image-first.
 */
export function buildMonthGrid(key: MonthKey): DayCell[][] {
  const { year, month } = key;
  const firstWeekday = new Date(Date.UTC(year, month - 1, 1)).getUTCDay();
  const daysInMonth = new Date(Date.UTC(year, month, 0)).getUTCDate();

  const cells: DayCell[] = Array.from({ length: firstWeekday }, () => null);
  for (let day = 1; day <= daysInMonth; day += 1) {
    cells.push({ iso: `${formatMonthKey(key)}-${String(day).padStart(2, "0")}`, day });
  }
  while (cells.length % 7 !== 0) cells.push(null);

  const weeks: DayCell[][] = [];
  for (let i = 0; i < cells.length; i += 7) weeks.push(cells.slice(i, i + 7));
  return weeks;
}

/** The calendar key for a stored `wornOn`, which is already UTC midnight. */
export function isoOf(date: Date): string {
  return date.toISOString().slice(0, 10);
}

/**
 * The seven days of the week containing `now`, Sunday to Saturday.
 *
 * Sunday-start to match `WEEKDAYS` and the month grid — a week that starts on a
 * different day from the calendar above it is its own small confusion.
 *
 * The week is decided by the user's *local* calendar date and then expressed as UTC
 * midnight, matching `todayUtc`: `wornOn` is a date column stored at UTC midnight, so
 * the days have to line up with it, but which day it is for the user is a local
 * question. Deriving the date itself in UTC would roll the week over in the evening
 * west of Greenwich, while it is still Saturday to the person looking at the screen.
 */
export function weekOf(now: Date = new Date()): Date[] {
  const today = new Date(
    Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()),
  );
  const sunday = new Date(today);
  sunday.setUTCDate(sunday.getUTCDate() - today.getUTCDay());

  return Array.from({ length: 7 }, (_, offset) => {
    const day = new Date(sunday);
    day.setUTCDate(sunday.getUTCDate() + offset);
    return day;
  });
}
