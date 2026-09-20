import { z } from "zod";

/**
 * A wear is recorded against a calendar day, not a moment.
 *
 * `wornOn` is a `@db.Date`, so the value must be built as UTC midnight of the date the
 * user picked. Passing "2026-09-19" to `new Date()` in a negative-offset timezone yields
 * the previous day once it round-trips, which would quietly file wears against the wrong
 * date — and the neglected calculation reads those dates.
 */
export function parseWornOn(value: string): Date | null {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value.trim());
  if (!match) return null;

  const [, year, month, day] = match;
  const date = new Date(Date.UTC(Number(year), Number(month) - 1, Number(day)));

  // Rejects impossible dates that the regex accepts, like 2026-02-31.
  if (date.getUTCMonth() !== Number(month) - 1 || date.getUTCDate() !== Number(day)) {
    return null;
  }
  return date;
}

/** Today as the user's calendar sees it, for defaults and future-date checks. */
export function todayUtc(now: Date = new Date()): Date {
  return new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
}

export const wearInputSchema = z.object({
  wornOn: z
    .string()
    .trim()
    .min(1, "Pick a date")
    .transform((value, ctx) => {
      const parsed = parseWornOn(value);
      if (!parsed) {
        ctx.addIssue({ code: "custom", message: "Not a valid date" });
        return z.NEVER;
      }
      // Forward dates are allowed: a future entry is a *plan*, not a claim about the
      // past, and planning tomorrow's outfit is the other half of what the calendar is
      // for. Nothing dated ahead of today counts as a wear until the day arrives — see
      // `hasHappened` — so stats and "last worn" are unaffected by planning.
      return parsed;
    }),
  note: z
    .string()
    .trim()
    .max(280)
    .optional()
    .transform((value) => (value ? value : undefined)),
});

export type WearInput = z.infer<typeof wearInputSchema>;
