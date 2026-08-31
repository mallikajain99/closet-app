/**
 * Neglected-item logic (spec §3, suggestion #7).
 *
 * A passive, glanceable flag — never a notification. Computed at read time, since it
 * changes with the calendar rather than with any write.
 */

/** Two months. Configurable per user via `User.neglectedThresholdDays`. */
export const DEFAULT_NEGLECTED_THRESHOLD_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between two dates, counting date boundaries crossed rather than elapsed hours.
 *
 * Both values are snapped to midnight before subtracting, so "worn yesterday at 11pm" and
 * "worn yesterday at 8am" both read as 1 day ago instead of 1 and 2. Without this, a wear
 * logged in the evening would appear to age a day faster than one logged in the morning.
 */
export function daysBetween(from: Date, to: Date): number {
  const fromUtc = Date.UTC(from.getFullYear(), from.getMonth(), from.getDate());
  const toUtc = Date.UTC(to.getFullYear(), to.getMonth(), to.getDate());
  return Math.floor((toUtc - fromUtc) / MS_PER_DAY);
}

/**
 * Days since last worn, or null if never worn.
 *
 * Null is meaningfully different from a large number: a never-worn item is a different
 * thing from a long-neglected one, and the UI should be able to say so.
 *
 * `lastWornOn` is the most recent wear date on record, which includes **backdated** wears.
 * Logging a past wear on an occasion piece — a formal dress worn last spring — moves this
 * date and clears the neglected flag, which is the intended way to keep genuinely-worn
 * items from being nagged about (spec §3).
 */
export function daysSinceLastWorn(
  lastWornOn: Date | null | undefined,
  now: Date = new Date(),
): number | null {
  if (!lastWornOn) return null;
  return daysBetween(lastWornOn, now);
}

/**
 * Whether to show the neglected marker.
 *
 * A never-worn item counts as neglected only once it has been in the catalog longer than
 * the threshold — the clock starts at the date it was added. Otherwise everything added
 * today would flag immediately, and the marker would become background noise.
 *
 * Note this is measured from when the item entered the catalog, not from its purchase
 * date: a vintage piece added today has been *yours* for years but has only been trackable
 * since today, and flagging it instantly would be wrong.
 */
export function isNeglected({
  lastWornOn,
  addedOn,
  thresholdDays = DEFAULT_NEGLECTED_THRESHOLD_DAYS,
  now = new Date(),
}: {
  lastWornOn: Date | null | undefined;
  addedOn: Date;
  thresholdDays?: number;
  now?: Date;
}): boolean {
  const sinceWorn = daysSinceLastWorn(lastWornOn, now);
  if (sinceWorn === null) {
    return daysBetween(addedOn, now) >= thresholdDays;
  }
  return sinceWorn >= thresholdDays;
}
