import { describe, expect, it } from "vitest";

import {
  buildMonthGrid,
  formatMonthKey,
  isoOf,
  monthLabel,
  monthRange,
  parseMonth,
  shiftMonth,
  weekOf,
} from "@/lib/wears/calendar";

describe("parseMonth", () => {
  it("reads a YYYY-MM key", () => {
    expect(parseMonth("2026-09")).toEqual({ year: 2026, month: 9 });
  });

  it("falls back to the month containing now", () => {
    const now = new Date(2026, 8, 19);
    expect(parseMonth(undefined, now)).toEqual({ year: 2026, month: 9 });
    expect(parseMonth("nonsense", now)).toEqual({ year: 2026, month: 9 });
    expect(parseMonth("2026-13", now)).toEqual({ year: 2026, month: 9 });
    expect(parseMonth("2026-00", now)).toEqual({ year: 2026, month: 9 });
  });
});

describe("monthRange", () => {
  it("covers the whole month in UTC", () => {
    // Wear dates are UTC midnight; a local-time range would drop the 1st or the last day
    // for anyone west of Greenwich.
    const { from, to } = monthRange({ year: 2026, month: 9 });
    expect(from.toISOString()).toBe("2026-09-01T00:00:00.000Z");
    expect(to.toISOString()).toBe("2026-09-30T23:59:59.999Z");
  });

  it("handles month length and leap years", () => {
    expect(monthRange({ year: 2026, month: 2 }).to.getUTCDate()).toBe(28);
    expect(monthRange({ year: 2028, month: 2 }).to.getUTCDate()).toBe(29);
    expect(monthRange({ year: 2026, month: 12 }).to.getUTCDate()).toBe(31);
  });

  it("includes a wear logged on the first and last day", () => {
    const { from, to } = monthRange({ year: 2026, month: 9 });
    const first = new Date(Date.UTC(2026, 8, 1));
    const last = new Date(Date.UTC(2026, 8, 30));
    for (const date of [first, last]) {
      expect(date >= from && date <= to).toBe(true);
    }
  });
});

describe("shiftMonth", () => {
  it("crosses a year boundary in both directions", () => {
    expect(shiftMonth({ year: 2026, month: 1 }, -1)).toEqual({ year: 2025, month: 12 });
    expect(shiftMonth({ year: 2026, month: 12 }, 1)).toEqual({ year: 2027, month: 1 });
  });
});

describe("buildMonthGrid", () => {
  it("lays the month out in whole weeks", () => {
    const weeks = buildMonthGrid({ year: 2026, month: 9 });
    for (const week of weeks) expect(week).toHaveLength(7);
    expect(weeks.flat().filter(Boolean)).toHaveLength(30);
  });

  it("pads the lead-in so the first day lands on its weekday", () => {
    // 1 Sep 2026 is a Tuesday, so two blanks precede it in a Sunday-first grid.
    const weeks = buildMonthGrid({ year: 2026, month: 9 });
    expect(weeks[0][0]).toBeNull();
    expect(weeks[0][1]).toBeNull();
    expect(weeks[0][2]).toEqual({ iso: "2026-09-01", day: 1 });
  });

  it("starts flush when the month begins on a Sunday", () => {
    // 1 Feb 2026 is a Sunday.
    const weeks = buildMonthGrid({ year: 2026, month: 2 });
    expect(weeks[0][0]).toEqual({ iso: "2026-02-01", day: 1 });
  });

  it("produces ISO keys that match a stored wornOn", () => {
    // This is the join between the grid and the query results; if the formats drift,
    // every cell silently renders empty.
    const weeks = buildMonthGrid({ year: 2026, month: 9 });
    const stored = new Date(Date.UTC(2026, 8, 19));
    expect(weeks.flat().some((cell) => cell?.iso === isoOf(stored))).toBe(true);
  });
});

describe("labels", () => {
  it("formats the month in UTC, not local time", () => {
    expect(monthLabel({ year: 2026, month: 1 })).toBe("January 2026");
    expect(formatMonthKey({ year: 2026, month: 3 })).toBe("2026-03");
  });
});

describe("weekOf", () => {
  it("runs Sunday to Saturday around the given day", () => {
    const week = weekOf(new Date("2026-09-23T12:00:00Z")); // a Wednesday
    expect(week).toHaveLength(7);
    expect(week.map(isoOf)).toEqual([
      "2026-09-20",
      "2026-09-21",
      "2026-09-22",
      "2026-09-23",
      "2026-09-24",
      "2026-09-25",
      "2026-09-26",
    ]);
  });

  it("keeps a Sunday as the start of its own week, not the end of the last", () => {
    const week = weekOf(new Date("2026-09-20T12:00:00Z"));
    expect(isoOf(week[0])).toBe("2026-09-20");
  });

  it("crosses a month boundary without renumbering", () => {
    const week = weekOf(new Date("2026-10-01T12:00:00Z")); // a Thursday
    expect(isoOf(week[0])).toBe("2026-09-27");
    expect(isoOf(week[6])).toBe("2026-10-03");
  });

  it("returns days at UTC midnight, so they match a stored wornOn exactly", () => {
    // Which day it is is a local question; `wornOn` is a UTC-midnight date column. The
    // days therefore carry the local calendar date expressed at UTC midnight, the same
    // convention as `todayUtc` — anything else makes grid lookups miss by a day.
    for (const day of weekOf(new Date("2026-09-23T12:00:00Z"))) {
      expect(day.getUTCHours()).toBe(0);
      expect(day.getUTCMinutes()).toBe(0);
      expect(day.getUTCSeconds()).toBe(0);
    }
  });
});
