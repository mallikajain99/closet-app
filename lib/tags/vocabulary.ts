import "server-only";

import { db } from "@/lib/db";

/**
 * Every tag the user has, most-used first.
 *
 * Alphabetical was the original order and it is the wrong one. The list is short
 * enough to print whole, so ordering is not about finding a tag in a long list — it is
 * about which tags are offered to the thumb first, and that should be the ones
 * actually in use. "Office" ahead of "beach" in November is worth more than O ahead of
 * B forever.
 *
 * Usage counts items *and* outfits, because the vocabulary is shared between them and
 * a tag heavily used on items is a tag the user thinks in.
 */
export async function tagVocabulary(userId: string): Promise<string[]> {
  const tags = await db.tag.findMany({
    where: { userId },
    select: {
      name: true,
      _count: { select: { items: true, outfits: true } },
    },
  });

  return tags
    .sort(
      (a, b) =>
        b._count.items + b._count.outfits - (a._count.items + a._count.outfits) ||
        // Stable tail, so unused tags don't shuffle between visits.
        a.name.localeCompare(b.name),
    )
    .map((tag) => tag.name);
}
