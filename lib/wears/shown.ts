/**
 * Which garments to draw for a logged wear.
 *
 * Two earlier decisions pull in opposite directions here, and both are right.
 *
 * A day spent in a saved outfit should show that outfit *as it stands now*: editing an
 * outfit to add shoes used to leave every day already logged showing the old,
 * shoeless version, while the cell linked to an outfit that plainly had shoes.
 *
 * But a day where the user threw a coat over the outfit should show the coat. That is
 * the whole point of recording what was actually worn, and falling back to the
 * outfit's definition would quietly drop it.
 *
 * The difference is knowable rather than a matter of taste. A wear is pinned to the
 * version it was logged against, so:
 *
 *   - wear's items ≠ the version it was pinned to  →  the user customised that day;
 *     show what she actually wore.
 *   - wear's items = the version it was pinned to  →  any difference from today's
 *     outfit comes from editing the outfit; show the outfit as it is now.
 */

export type ShownItem = { id: string };

export type ShowableWear<T extends ShownItem> = {
  /** What was logged, after any additions or substitutions. */
  items: T[];
  /** The outfit version this wear was pinned to, if it came from an outfit. */
  pinnedItems: T[] | null;
  /** The outfit's current version, if it still has one. */
  currentItems: T[] | null;
};

const sameSet = (a: readonly ShownItem[], b: readonly ShownItem[]) => {
  if (a.length !== b.length) return false;
  const ids = new Set(a.map((item) => item.id));
  return b.every((item) => ids.has(item.id));
};

export function itemsToShow<T extends ShownItem>(wear: ShowableWear<T>): T[] {
  // Loose items, or an outfit since deleted: what was logged is all there is.
  if (!wear.pinnedItems || !wear.currentItems) return wear.items;

  const customised = !sameSet(wear.items, wear.pinnedItems);
  return customised ? wear.items : wear.currentItems;
}
