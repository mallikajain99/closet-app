/**
 * Neglected-item logic (spec §3, suggestion #7).
 *
 * A passive, glanceable flag — never a notification. Computed at read time, since it
 * changes with the calendar rather than with any write.
 */

export const DEFAULT_NEGLECTED_THRESHOLD_DAYS = 60;

const MS_PER_DAY = 24 * 60 * 60 * 1000;

/**
 * Whole days between two dates, counted in calendar days rather than elapsed time.
 *
 * Both values are normalized to UTC midnight first. Comparing raw timestamps would make
 * "worn yesterday evening" and "worn yesterday morning" give different day counts, and
 * would shift results across daylight-saving boundaries.
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
 * A never-worn item counts as neglected only once it has been owned longer than the
 * threshold — otherwise everything added to the closet today would be flagged
 * immediately, which would train the eye to ignore the marker entirely.
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
