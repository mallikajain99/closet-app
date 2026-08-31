/**
 * Date ranges for wear statistics (spec §3).
 *
 * "This month" means the **calendar month** — August 1st through August 31st — not a
 * rolling 30-day window ending today. Same for "this year". A calendar month is what you
 * can actually reason about ("I wore this twice in August"); a rolling window silently
 * changes its own boundaries every day, so the same number means something different each
 * time you look at it.
 *
 * Short windows stay rolling, because "the last 7 days" is genuinely what's meant there
 * and a partial calendar week would be misleading on a Monday.
 *
 * All boundaries are constructed in **local time**, since these are the user's calendar
 * dates, not UTC instants.
 */

export type DateRange = { from: Date; to: Date };

export type WearWindow =
  | "last7Days"
  | "last30Days"
  | "thisMonth"
  | "lastMonth"
  | "thisYear"
  | "allTime";

/** First moment of the day, local time. */
export function startOfDay(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), date.getDate());
}

/** Last moment of the day, local time. */
export function endOfDay(date: Date): Date {
  return new Date(
    date.getFullYear(),
    date.getMonth(),
    date.getDate(),
    23,
    59,
    59,
    999,
  );
}

export function startOfMonth(date: Date): Date {
  return new Date(date.getFullYear(), date.getMonth(), 1);
}

/** Day 0 of the next month is the last day of this one, which handles month length and leap years. */
export function endOfMonth(date: Date): Date {
  return endOfDay(new Date(date.getFullYear(), date.getMonth() + 1, 0));
}

export function startOfYear(date: Date): Date {
  return new Date(date.getFullYear(), 0, 1);
}

export function endOfYear(date: Date): Date {
  return endOfDay(new Date(date.getFullYear(), 11, 31));
}

/** A rolling window of the last `days` days, inclusive of today. */
export function rollingDays(days: number, now: Date = new Date()): DateRange {
  const from = startOfDay(now);
  from.setDate(from.getDate() - (days - 1));
  return { from, to: endOfDay(now) };
}

/** Resolve a named window to concrete dates. `allTime` has no lower bound. */
export function resolveWindow(
  window: WearWindow,
  now: Date = new Date(),
): DateRange | null {
  switch (window) {
    case "last7Days":
      return rollingDays(7, now);
    case "last30Days":
      return rollingDays(30, now);
    case "thisMonth":
      return { from: startOfMonth(now), to: endOfMonth(now) };
    case "lastMonth": {
      const prev = new Date(now.getFullYear(), now.getMonth() - 1, 1);
      return { from: startOfMonth(prev), to: endOfMonth(prev) };
    }
    case "thisYear":
      return { from: startOfYear(now), to: endOfYear(now) };
    case "allTime":
      return null;
  }
}

/** Human label for a window, for stat tiles and filter chips. */
export function windowLabel(window: WearWindow, now: Date = new Date()): string {
  switch (window) {
    case "last7Days":
      return "Last 7 days";
    case "last30Days":
      return "Last 30 days";
    case "thisMonth":
      return now.toLocaleDateString("en-US", { month: "long" });
    case "lastMonth":
      return new Date(now.getFullYear(), now.getMonth() - 1, 1).toLocaleDateString(
        "en-US",
        { month: "long" },
      );
    case "thisYear":
      return String(now.getFullYear());
    case "allTime":
      return "All time";
  }
}
