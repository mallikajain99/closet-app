import { colorFamily } from "@/lib/items/colors";
import type { Category, PieceMatch } from "@prisma/client";

/**
 * Decide whether the user already owns a garment seen in an inspiration.
 *
 * Three outcomes, not two, and the middle one carries the feature. "Own it" / "buy it"
 * is the obvious design and it lies in both directions: a wrong confident match
 * silently deletes something from the shopping list, and treating a near-match as
 * missing sends her shopping for a sweater she basically has. **CLOSE** — same
 * garment, wrong colour — is the answer a person would actually give, and it is hers
 * to resolve rather than the app's.
 *
 * Deliberately conservative about OWNED. An unmatched piece costs a glance at the
 * shopping list; a falsely matched one costs an outfit she can't make.
 */

export type ClosetItem = {
  id: string;
  name: string;
  category: Category;
  subcategory: string | null;
  colors: string[];
};

export type WantedPiece = {
  category: Category;
  subcategory: string;
  color: string | null;
  description: string;
};

export type MatchResult = {
  match: PieceMatch;
  itemId: string | null;
  /** Why, in words, for the UI — a verdict with no reason can't be argued with. */
  reason: string;
};

const lower = (value: string | null | undefined) => value?.trim().toLowerCase() ?? "";

const STOP = new Set(["the", "and", "with", "a", "of", "in"]);

const wordsOf = (value: string) =>
  new Set(value.toLowerCase().match(/[a-z]{3,}/g)?.filter((word) => !STOP.has(word)) ?? []);

/**
 * Shared words between two garment names, *excluding* the ones already scored.
 *
 * Counting the category and colour words here as well was double-counting, and it
 * produced the failure this whole three-outcome design exists to avoid: a photo of a
 * raspberry midi dress, read as "red maxi dress", matched a dark red maxi dress in the
 * closet with full confidence. Category and colour agreed, and "red", "maxi" and
 * "dress" were then counted a second time as though they were evidence about *which*
 * red maxi dress it was.
 *
 * What is left after removing them is the part that identifies a specific garment —
 * "burnout", "slip", "puff-sleeve" — and that is what OWNED should turn on.
 */
function distinctiveOverlap(
  wanted: WantedPiece,
  item: ClosetItem,
): number {
  const spent = new Set([
    ...wordsOf(wanted.subcategory),
    ...wordsOf(wanted.color ?? ""),
    ...wordsOf(item.subcategory ?? ""),
    ...item.colors.flatMap((colour) => [...wordsOf(colour)]),
  ]);

  const left = wordsOf(wanted.description);
  const right = wordsOf(item.name);

  let shared = 0;
  for (const word of left) {
    if (spent.has(word)) continue;
    if (right.has(word)) shared += 1;
  }
  return shared;
}

/** Whether two written colours belong to the same family — "navy" and "midnight". */
function sameColorFamily(a: string | null, b: readonly string[]): boolean {
  if (!a) return false;
  const family = colorFamily(a)?.key;
  if (!family) return false;
  return b.some((candidate) => colorFamily(candidate)?.key === family);
}

/**
 * Score how well a closet item answers a wanted piece.
 *
 * Category is a precondition rather than a score: a bag is never a near-miss for a
 * pair of jeans, however the words line up.
 */
function score(wanted: WantedPiece, item: ClosetItem): number {
  if (wanted.category !== item.category) return -1;

  let points = 0;
  const wantedKind = lower(wanted.subcategory);
  const itemKind = lower(item.subcategory);

  if (wantedKind && itemKind) {
    if (wantedKind === itemKind) points += 4;
    else if (wantedKind.includes(itemKind) || itemKind.includes(wantedKind)) points += 3;
  }

  // What is left once category and colour are set aside: the words that say *which*
  // garment this is.
  points += Math.min(3, distinctiveOverlap(wanted, item));

  if (sameColorFamily(wanted.color, item.colors)) points += 3;

  return points;
}

/**
 * The closest thing in the closet, and how close it is.
 *
 * OWNED needs three things to agree: the kind, the colour, and something that
 * identifies *that particular* garment. Kind and colour alone describe a whole shelf.
 * Anything plainly the same garment without that third signal is CLOSE, shown to the
 * user with the item so she can decide. Everything else is MISSING and becomes a line
 * on the shopping list.
 */
export function matchPiece(wanted: WantedPiece, closet: readonly ClosetItem[]): MatchResult {
  let best: ClosetItem | null = null;
  let bestScore = 0;

  for (const item of closet) {
    const value = score(wanted, item);
    if (value > bestScore) {
      bestScore = value;
      best = item;
    }
  }

  if (!best) {
    return { match: "MISSING", itemId: null, reason: "Nothing like it in your closet" };
  }

  const colorAgrees = sameColorFamily(wanted.color, best.colors);
  const distinctive = distinctiveOverlap(wanted, best);
  const kindAgrees = bestScore - (colorAgrees ? 3 : 0) - Math.min(3, distinctive) >= 3;

  // OWNED needs the kind, the colour, *and* something that identifies this particular
  // garment. Kind and colour alone describe a whole shelf: "red maxi dress" is not an
  // identification, and treating it as one removes a real want from the shopping list.
  // Without that third signal it is CLOSE, which is shown with the item so the user
  // can say which it is.
  if (kindAgrees && colorAgrees && distinctive > 0) {
    return { match: "OWNED", itemId: best.id, reason: `You have ${best.name}` };
  }
  if (kindAgrees) {
    return {
      match: "CLOSE",
      itemId: best.id,
      reason: `You have something like it — ${best.name}`,
    };
  }
  return { match: "MISSING", itemId: null, reason: "Nothing like it in your closet" };
}

export type WishlistEntry = {
  description: string;
  category: Category;
  /** Inspirations this piece appears in, by name. */
  wantedBy: string[];
  /** Inspirations where it is the *only* thing still missing. */
  unlocks: string[];
};

/**
 * The shopping list, ranked by leverage rather than by how often a piece appears.
 *
 * A garment that is the only thing still missing from three inspirations is worth more
 * than one wanted by five looks that are half-missing anyway, because only the first
 * kind turns into a wearable outfit the day it is bought. Sorting by frequency would
 * put the second first and send her shopping for the wrong thing.
 */
export function buildWishlist(
  inspirations: readonly {
    name: string;
    pieces: readonly { description: string; category: Category; match: PieceMatch; boughtAt: Date | null }[];
  }[],
): WishlistEntry[] {
  const entries = new Map<string, WishlistEntry>();

  for (const inspiration of inspirations) {
    const outstanding = inspiration.pieces.filter(
      (piece) => piece.match === "MISSING" && !piece.boughtAt,
    );

    for (const piece of outstanding) {
      const key = `${piece.category}:${piece.description.toLowerCase()}`;
      const entry = entries.get(key) ?? {
        description: piece.description,
        category: piece.category,
        wantedBy: [],
        unlocks: [],
      };
      entry.wantedBy.push(inspiration.name);
      // The whole look hinges on this one piece.
      if (outstanding.length === 1) entry.unlocks.push(inspiration.name);
      entries.set(key, entry);
    }
  }

  return [...entries.values()].sort(
    (a, b) =>
      b.unlocks.length - a.unlocks.length ||
      b.wantedBy.length - a.wantedBy.length ||
      a.description.localeCompare(b.description),
  );
}
