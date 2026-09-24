/**
 * "Not right now" — keeping an outfit in the closet but out of suggestions.
 *
 * The problem this solves is one the rotation scorer creates. Suggestions favour what
 * has gone longest unworn, so the outfits you have deliberately stopped reaching for
 * rise to the top and stay there: an interview suit is, by that measure, the single
 * most overdue thing you own. Damping by kind doesn't help, because nothing similar is
 * being worn either.
 *
 * Inferring it from formality was the obvious guess and it is wrong — the user rotates
 * work outfits in on purpose, while never touching the most formal ones. The only
 * reliable source is the user, so this is an action rather than a heuristic.
 */

export type SetAsideState = {
  snoozedUntil: Date | null;
  shelvedAt: Date | null;
};

/** Whether an outfit is currently held back from suggestions. */
export function isSetAside(outfit: SetAsideState, now: Date = new Date()): boolean {
  if (outfit.shelvedAt) return true;
  return outfit.snoozedUntil !== null && outfit.snoozedUntil.getTime() > now.getTime();
}

/** How to describe the hold, for a badge. Null when the outfit is active. */
export function setAsideLabel(
  outfit: SetAsideState,
  now: Date = new Date(),
): string | null {
  if (outfit.shelvedAt) return "Shelved";
  if (!outfit.snoozedUntil || outfit.snoozedUntil.getTime() <= now.getTime()) return null;

  const days = Math.ceil((outfit.snoozedUntil.getTime() - now.getTime()) / 86_400_000);
  return days <= 1 ? "Back tomorrow" : `Back in ${days} days`;
}

/** The snooze lengths offered. Short enough to be reversible, long enough to matter. */
export const SNOOZE_OPTIONS = [
  { days: 14, label: "2 weeks" },
  { days: 30, label: "A month" },
  { days: 90, label: "3 months" },
] as const;

/** A snooze end date, at UTC midnight to match the rest of the date handling here. */
export function snoozeUntil(days: number, now: Date = new Date()): Date {
  const until = new Date(
    Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), now.getUTCDate()),
  );
  until.setUTCDate(until.getUTCDate() + days);
  return until;
}

/**
 * A Prisma filter for outfits that should appear in suggestions.
 *
 * Expressed as a filter rather than applied in memory because both lists that need it
 * — suggestions and least-worn — page through the results, and filtering after the
 * fact would leave short pages.
 */
export function notSetAside(now: Date = new Date()) {
  return {
    shelvedAt: null,
    OR: [{ snoozedUntil: null }, { snoozedUntil: { lte: now } }],
  };
}
