import { describe, expect, it } from "vitest";

import { isSetAside, notSetAside, setAsideLabel, snoozeUntil } from "@/lib/outfits/set-aside";

const NOW = new Date("2026-09-24T15:00:00Z");
const active = { snoozedUntil: null, shelvedAt: null };

describe("isSetAside", () => {
  it("holds back a shelved outfit with no end date", () => {
    expect(isSetAside({ ...active, shelvedAt: new Date("2026-01-01") }, NOW)).toBe(true);
  });

  it("holds back a snooze that has not run out", () => {
    expect(isSetAside({ ...active, snoozedUntil: new Date("2026-10-01") }, NOW)).toBe(true);
  });

  it("releases a snooze once its date has passed", () => {
    // The whole point of a snooze over a shelf: it comes back on its own.
    expect(isSetAside({ ...active, snoozedUntil: new Date("2026-09-20") }, NOW)).toBe(false);
  });

  it("leaves an untouched outfit alone", () => {
    expect(isSetAside(active, NOW)).toBe(false);
  });
});

describe("setAsideLabel", () => {
  it("says shelved without a date, because there isn't one", () => {
    expect(setAsideLabel({ ...active, shelvedAt: NOW }, NOW)).toBe("Shelved");
  });

  it("counts down a snooze", () => {
    expect(setAsideLabel({ ...active, snoozedUntil: new Date("2026-10-04T00:00:00Z") }, NOW))
      .toBe("Back in 10 days");
  });

  it("says nothing for an outfit in rotation", () => {
    expect(setAsideLabel(active, NOW)).toBeNull();
  });

  it("prefers the shelf when both are set, since it is the stronger hold", () => {
    expect(
      setAsideLabel({ snoozedUntil: new Date("2026-10-01"), shelvedAt: NOW }, NOW),
    ).toBe("Shelved");
  });
});

describe("snoozeUntil", () => {
  it("lands on UTC midnight, matching how wear dates are stored", () => {
    const until = snoozeUntil(30, NOW);
    expect(until.toISOString()).toBe("2026-10-24T00:00:00.000Z");
  });
});

describe("notSetAside", () => {
  it("asks for no shelf, and either no snooze or an expired one", () => {
    const filter = notSetAside(NOW);
    expect(filter.shelvedAt).toBeNull();
    expect(filter.OR).toEqual([{ snoozedUntil: null }, { snoozedUntil: { lte: NOW } }]);
  });
});
