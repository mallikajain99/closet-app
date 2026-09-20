import { describe, expect, it } from "vitest";

import { happened, hasHappened, planned } from "@/lib/wears/planned";

const NOW = new Date("2026-09-20T15:00:00Z");
const utc = (iso: string) => new Date(`${iso}T00:00:00Z`);

describe("hasHappened", () => {
  it("counts today, since a wear logged this morning has happened", () => {
    expect(hasHappened(utc("2026-09-20"), NOW)).toBe(true);
  });

  it("counts the past", () => {
    expect(hasHappened(utc("2026-01-01"), NOW)).toBe(true);
  });

  it("does not count tomorrow", () => {
    expect(hasHappened(utc("2026-09-21"), NOW)).toBe(false);
  });

  it("ignores the time of day, so a plan does not become a wear at noon", () => {
    // `wornOn` is a date column stored at UTC midnight; comparing against a raw `now`
    // rather than the day boundary would flip tomorrow's plan to "happened" partway
    // through today in some timezones.
    const lateInTheDay = new Date("2026-09-20T23:59:59Z");
    expect(hasHappened(utc("2026-09-21"), lateInTheDay)).toBe(false);
  });
});

describe("filters", () => {
  it("splits the timeline at the end of today with no gap and no overlap", () => {
    const cutoff = happened(NOW).wornOn.lte;
    expect(planned(NOW).wornOn.gt).toEqual(cutoff);
    expect(cutoff).toEqual(utc("2026-09-20"));
  });
});
