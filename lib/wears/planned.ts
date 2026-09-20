import { todayUtc } from "@/lib/validation/wear";

/**
 * A wear dated ahead of today is a *plan*, not a wear.
 *
 * Wears and plans share one table, because they are the same shape and the calendar
 * wants them side by side: the row that says "I'm wearing this on Friday" becomes the
 * row that says "I wore this on Friday" the moment Friday arrives, with nothing to
 * migrate and no chance of the two disagreeing.
 *
 * The cost of that is one rule, applied everywhere: **a plan must never be counted.**
 * Wear counts, "last worn", cost-per-wear and the neglected clock all read these rows,
 * and a planned outfit that inflated its own wear count would make every one of those
 * numbers a guess about the future. So every count filters on `happened()`, and the
 * only places that see a future row are the ones deliberately showing plans.
 */

/** Prisma filter for wears that have actually happened. */
export function happened(now: Date = new Date()) {
  return { wornOn: { lte: todayUtc(now) } };
}

/** The same rule for rows already in memory. */
export function hasHappened(wornOn: Date, now: Date = new Date()): boolean {
  return wornOn.getTime() <= todayUtc(now).getTime();
}

/** Prisma filter for the plans only — everything still ahead of today. */
export function planned(now: Date = new Date()) {
  return { wornOn: { gt: todayUtc(now) } };
}
