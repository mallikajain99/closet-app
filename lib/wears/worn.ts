/**
 * What was actually on, for one day, given an outfit and the day's changes.
 *
 * Deliberately not `server-only` and deliberately not inline in the action: this is the
 * rule that decides what a wear records, and therefore what every item statistic counts.
 * A coat left out of this list never gets a wear; a hat wrongly kept in it gets one it
 * was never worn for. That is worth being able to test without a database.
 */

export type WornChanges = {
  /** The pieces of the outfit version this wear is pinned to. */
  outfitItemIds: readonly string[];
  /** Pieces added for this day only. */
  added?: readonly string[];
  /** Pieces of the outfit deliberately not worn today — the hat you own but skipped. */
  removed?: readonly string[];
};

export function wornItemIds({ outfitItemIds, added = [], removed = [] }: WornChanges) {
  const left = new Set(removed);

  // Removal wins over addition when a piece is somehow in both. The two cannot both be
  // true of one day, and "I did not wear it" is the more specific statement — it names a
  // garment the outfit already contained, where an addition may just be a stale click.
  const ids = [...outfitItemIds.filter((id) => !left.has(id)), ...added].filter(
    (id) => !left.has(id),
  );

  // Deduplicated because adding a piece the outfit already contains is a reasonable
  // thing for a user to do — it is not an error, it is a no-op — and the caller writes
  // one row per id.
  return [...new Set(ids)];
}
