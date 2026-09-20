import { describe, expect, it } from "vitest";

import { parseWornOn, todayUtc, wearInputSchema } from "@/lib/validation/wear";

describe("parseWornOn", () => {
  it("builds UTC midnight of the date the user picked", () => {
    // The column is a DATE. Parsing "2026-09-19" with `new Date()` in a negative-offset
    // timezone lands on the 18th once it round-trips, which files wears a day early and
    // feeds the neglected calculation the wrong date.
    const date = parseWornOn("2026-09-19")!;
    expect(date.toISOString()).toBe("2026-09-19T00:00:00.000Z");
    expect(date.getUTCDate()).toBe(19);
  });

  it("rejects malformed input", () => {
    expect(parseWornOn("19/09/2026")).toBeNull();
    expect(parseWornOn("2026-9-1")).toBeNull();
    expect(parseWornOn("")).toBeNull();
    expect(parseWornOn("not a date")).toBeNull();
  });

  it("rejects a well-formed but impossible date", () => {
    // The regex accepts it; the calendar does not.
    expect(parseWornOn("2026-02-31")).toBeNull();
    expect(parseWornOn("2026-13-01")).toBeNull();
  });

  it("accepts a leap day in a leap year and rejects it otherwise", () => {
    expect(parseWornOn("2028-02-29")).not.toBeNull();
    expect(parseWornOn("2026-02-29")).toBeNull();
  });
});

describe("todayUtc", () => {
  it("uses the local calendar day, projected to UTC midnight", () => {
    // 11pm on the 19th locally is still the 19th, whatever the offset does to the clock.
    const local = new Date(2026, 8, 19, 23, 30);
    expect(todayUtc(local).toISOString()).toBe("2026-09-19T00:00:00.000Z");
  });
});

describe("wearInputSchema", () => {
  const dateOf = (offsetDays: number) => {
    const base = todayUtc();
    base.setUTCDate(base.getUTCDate() + offsetDays);
    return base.toISOString().slice(0, 10);
  };

  it("accepts today", () => {
    const parsed = wearInputSchema.safeParse({ wornOn: dateOf(0) });
    expect(parsed.success).toBe(true);
  });

  it("accepts a past date, which is the whole point of backdating", () => {
    const parsed = wearInputSchema.safeParse({ wornOn: dateOf(-30) });
    expect(parsed.success).toBe(true);
  });

  it("accepts a future date, which is how an outfit gets planned", () => {
    // Forward dates used to be rejected as always-a-mistake. They are a plan instead:
    // what keeps them honest is that nothing counts them until the day arrives, which
    // `hasHappened` enforces rather than the parser.
    const parsed = wearInputSchema.safeParse({ wornOn: dateOf(3) });
    expect(parsed.success).toBe(true);
  });

  it("treats a blank note as absent", () => {
    const parsed = wearInputSchema.parse({ wornOn: dateOf(0), note: "   " });
    expect(parsed.note).toBeUndefined();
  });
});
