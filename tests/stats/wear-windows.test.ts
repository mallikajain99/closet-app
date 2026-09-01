import { describe, expect, it } from "vitest";

import {
  endOfMonth,
  resolveWindow,
  rollingDays,
  startOfMonth,
  windowLabel,
} from "@/lib/stats/wear-windows";

/** 3 August 2026 — early in the month, where calendar and rolling windows diverge most. */
const EARLY_AUGUST = new Date(2026, 7, 3, 14, 30);

describe("calendar month boundaries", () => {
  it("starts the month on the 1st", () => {
    expect(startOfMonth(EARLY_AUGUST)).toEqual(new Date(2026, 7, 1));
  });

  it("ends the month on its last day", () => {
    expect(endOfMonth(EARLY_AUGUST).getDate()).toBe(31);
  });

  it("handles a 30-day month", () => {
    expect(endOfMonth(new Date(2026, 8, 10)).getDate()).toBe(30); // September
  });

  it("handles February in a non-leap year", () => {
    expect(endOfMonth(new Date(2026, 1, 10)).getDate()).toBe(28);
  });

  it("handles February in a leap year", () => {
    expect(endOfMonth(new Date(2028, 1, 10)).getDate()).toBe(29);
  });
});

describe("thisMonth is a calendar period, not a rolling window", () => {
  it("starts on the 1st even when only a few days into the month", () => {
    // The correction that matters: on 3 August, "this month" covers 1–31 August.
    // A rolling 30-day window would instead reach back into early July, so the same
    // label would silently mean a different span every day.
    const range = resolveWindow("thisMonth", EARLY_AUGUST)!;

    expect(range.from).toEqual(new Date(2026, 7, 1));
    expect(range.from.getMonth()).toBe(7);
    expect(range.to.getDate()).toBe(31);
  });

  it("differs from a rolling 30-day window early in the month", () => {
    const calendar = resolveWindow("thisMonth", EARLY_AUGUST)!;
    const rolling = resolveWindow("last30Days", EARLY_AUGUST)!;

    expect(rolling.from.getMonth()).toBe(6); // reaches back into July
    expect(calendar.from.getMonth()).toBe(7); // stays in August
  });
});

describe("rolling windows", () => {
  it("includes today in the last 7 days", () => {
    const range = rollingDays(7, EARLY_AUGUST);

    // 28 July through 3 August inclusive is 7 days, not 8.
    expect(range.from).toEqual(new Date(2026, 6, 28));
    expect(range.to.getDate()).toBe(3);
  });
});

describe("lastMonth", () => {
  it("resolves to the previous calendar month", () => {
    const range = resolveWindow("lastMonth", EARLY_AUGUST)!;

    expect(range.from).toEqual(new Date(2026, 6, 1));
    expect(range.to.getDate()).toBe(31); // July
  });

  it("crosses the year boundary from January", () => {
    const range = resolveWindow("lastMonth", new Date(2026, 0, 15))!;

    expect(range.from).toEqual(new Date(2025, 11, 1));
    expect(range.from.getFullYear()).toBe(2025);
  });
});

describe("thisYear", () => {
  it("spans January 1st to December 31st", () => {
    const range = resolveWindow("thisYear", EARLY_AUGUST)!;

    expect(range.from).toEqual(new Date(2026, 0, 1));
    expect(range.to.getMonth()).toBe(11);
    expect(range.to.getDate()).toBe(31);
  });
});

describe("allTime", () => {
  it("has no bounds", () => {
    expect(resolveWindow("allTime", EARLY_AUGUST)).toBeNull();
  });
});

describe("windowLabel", () => {
  it("names the calendar month rather than a day count", () => {
    expect(windowLabel("thisMonth", EARLY_AUGUST)).toBe("August");
    expect(windowLabel("lastMonth", EARLY_AUGUST)).toBe("July");
  });

  it("names the year", () => {
    expect(windowLabel("thisYear", EARLY_AUGUST)).toBe("2026");
  });

  it("keeps rolling windows described as day counts", () => {
    expect(windowLabel("last7Days", EARLY_AUGUST)).toBe("Last 7 days");
  });
});
