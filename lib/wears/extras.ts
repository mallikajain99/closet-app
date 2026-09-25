import "server-only";

import { db } from "@/lib/db";
import type { Category } from "@prisma/client";

/**
 * What the user habitually throws over a saved outfit.
 *
 * "Chances are I'm probably just wearing the same outerwear over existing outfits" —
 * so the picker should already be offering it. Typing the name of the same coat every
 * time is the kind of friction that stops a log being kept.
 *
 * Learned from her own history rather than assumed: an *extra* is an item recorded on
 * a wear that was not in the outfit version that wear was pinned to. Counting those
 * says which garments actually get added, which is a different question from which
 * get worn.
 *
 * Falls back to outerwear and shoes when there is no history to learn from — the two
 * categories that are swapped over a fixed outfit in practice — so the picker is
 * useful on day one rather than only after a month of logging.
 */

const FALLBACK_CATEGORIES: Category[] = ["OUTERWEAR", "SHOE"];

/** How many wears back to learn from. Enough to see a habit, cheap to read. */
const HISTORY_DEPTH = 80;

export async function suggestedExtras(
  userId: string,
  excludeIds: readonly string[],
  limit = 8,
): Promise<string[]> {
  const wears = await db.wearLog.findMany({
    where: { userId, outfitId: { not: null } },
    orderBy: { wornOn: "desc" },
    take: HISTORY_DEPTH,
    select: {
      items: { select: { itemId: true } },
      outfitVersion: { select: { items: { select: { itemId: true } } } },
    },
  });

  const added = new Map<string, number>();
  for (const wear of wears) {
    if (!wear.outfitVersion) continue;
    const pinned = new Set(wear.outfitVersion.items.map((link) => link.itemId));
    for (const link of wear.items) {
      if (pinned.has(link.itemId)) continue;
      added.set(link.itemId, (added.get(link.itemId) ?? 0) + 1);
    }
  }

  const excluded = new Set(excludeIds);
  const learned = [...added.entries()]
    .filter(([itemId]) => !excluded.has(itemId))
    .sort((a, b) => b[1] - a[1])
    .map(([itemId]) => itemId);

  if (learned.length >= limit) return learned.slice(0, limit);

  // Pad with the categories that get swapped in practice, most recently added first.
  const padding = await db.item.findMany({
    where: {
      userId,
      status: "ACTIVE",
      category: { in: FALLBACK_CATEGORIES },
      id: { notIn: [...excluded, ...learned] },
    },
    orderBy: { createdAt: "desc" },
    take: limit - learned.length,
    select: { id: true },
  });

  return [...learned, ...padding.map((item) => item.id)];
}
