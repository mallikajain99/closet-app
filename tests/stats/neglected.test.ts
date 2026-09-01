import { describe, expect, it } from "vitest";

import {
  DEFAULT_NEGLECTED_THRESHOLD_DAYS,
  daysBetween,
  daysSinceLastWorn,
  isNeglected,
} from "@/lib/stats/neglected";

/** 15 August 2026, local time. */
const NOW = new Date(2026, 7, 15);

function daysAgo(days: number, from: Date = NOW): Date {
  const date = new Date(from);
  date.setDate(date.getDate() - days);
  return date;
}

describe("daysBetween", () => {
  it("counts date boundaries crossed, not elapsed hours", () => {
    // Worn at 11pm; it is now 8am the next morning. That is 9 hours, but one calendar
    // day. Without midnight snapping an evening wear would age faster than a morning one.
    const lateEvening = new Date(2026, 7, 14, 23, 0);
    const nextMorning = new Date(2026, 7, 15, 8, 0);

    expect(daysBetween(lateEvening, nextMorning)).toBe(1);
  });

  it("treats two times on the same day as zero days apart", () => {
    expect(
      daysBetween(new Date(2026, 7, 15, 1, 0), new Date(2026, 7, 15, 23, 0)),
    ).toBe(0);
  });

  it("counts across a month boundary", () => {
    expect(daysBetween(new Date(2026, 6, 31), new Date(2026, 7, 2))).toBe(2);
  });
});

describe("daysSinceLastWorn", () => {
  it("returns the day count for a worn item", () => {
    expect(daysSinceLastWorn(daysAgo(10), NOW)).toBe(10);
  });

  it("distinguishes never-worn from long-neglected", () => {
    // Null rather than a large number: "never worn" is a different statement from
    // "not worn in a long time", and the UI should be able to say which.
    expect(daysSinceLastWorn(null, NOW)).toBeNull();
  });
});

describe("isNeglected", () => {
  const addedLongAgo = daysAgo(365);

  it("does not flag a recently worn item", () => {
    expect(
      isNeglected({ lastWornOn: daysAgo(3), addedOn: addedLongAgo, now: NOW }),
    ).toBe(false);
  });

  it("flags an item past the two-month threshold", () => {
    expect(
      isNeglected({ lastWornOn: daysAgo(61), addedOn: addedLongAgo, now: NOW }),
    ).toBe(true);
  });

  it("flags exactly at the threshold", () => {
    expect(
      isNeglected({
        lastWornOn: daysAgo(DEFAULT_NEGLECTED_THRESHOLD_DAYS),
        addedOn: addedLongAgo,
        now: NOW,
      }),
    ).toBe(true);
  });

  it("does not flag one day before the threshold", () => {
    expect(
      isNeglected({
        lastWornOn: daysAgo(DEFAULT_NEGLECTED_THRESHOLD_DAYS - 1),
        addedOn: addedLongAgo,
        now: NOW,
      }),
    ).toBe(false);
  });

  it("respects a custom threshold", () => {
    expect(
      isNeglected({
        lastWornOn: daysAgo(20),
        addedOn: addedLongAgo,
        thresholdDays: 14,
        now: NOW,
      }),
    ).toBe(true);
  });

  describe("never-worn items", () => {
    it("does not flag something added today", () => {
      // Otherwise every new item flags the moment it's catalogued and the marker
      // becomes background noise.
      expect(
        isNeglected({ lastWornOn: null, addedOn: NOW, now: NOW }),
      ).toBe(false);
    });

    it("does not flag something added a month ago", () => {
      expect(
        isNeglected({ lastWornOn: null, addedOn: daysAgo(30), now: NOW }),
      ).toBe(false);
    });

    it("flags something in the catalog over two months without a wear", () => {
      expect(
        isNeglected({ lastWornOn: null, addedOn: daysAgo(61), now: NOW }),
      ).toBe(true);
    });
  });

  describe("retroactive wear logging (spec §3)", () => {
    it("clears the flag when a past wear is backdated in", () => {
      // The formal-dress case: worn to a wedding in spring, catalogued long ago, not
      // worn since. Before the backdated wear it reads as neglected; adding the real
      // past date corrects it, without pretending it was worn recently.
      const dress = { addedOn: daysAgo(300), now: NOW };

      expect(isNeglected({ ...dress, lastWornOn: null })).toBe(true);
      expect(isNeglected({ ...dress, lastWornOn: daysAgo(40) })).toBe(false);
    });

    it("still flags when the backdated wear is itself older than the threshold", () => {
      // Honest behaviour: logging a wear from a year ago shouldn't clear the flag.
      expect(
        isNeglected({
          lastWornOn: daysAgo(200),
          addedOn: daysAgo(300),
          now: NOW,
        }),
      ).toBe(true);
    });
  });
});
