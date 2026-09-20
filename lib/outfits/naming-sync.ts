import "server-only";

import { db } from "@/lib/db";
import { suggestOutfitNames } from "@/lib/outfits/name";

/**
 * Keep auto-generated outfit names in step with the items they describe.
 *
 * Rename a garment from "Blue shirt" to "Cornflower blue popover" and every outfit
 * named after it is suddenly describing something that no longer exists. But a name the
 * user typed themselves must never be overwritten, and the schema has no flag saying
 * which is which.
 *
 * It doesn't need one. An auto-generated name is, by definition, one of the suggestions
 * for that item set — so comparing the stored name against the suggestions computed
 * from the item's *old* values identifies it exactly. That has to happen before the
 * item is written, which is why this is two calls rather than one.
 */

type Snapshot = { outfitId: string };

/** Outfits containing this item whose current name looks auto-generated. */
export async function captureAutoNamedOutfits(
  userId: string,
  itemId: string,
): Promise<Snapshot[]> {
  const versions = await db.outfitVersion.findMany({
    where: {
      supersededAt: null,
      outfit: { userId },
      items: { some: { itemId } },
    },
    select: {
      outfit: { select: { id: true, name: true } },
      items: {
        select: {
          item: { select: { category: true, subcategory: true, colors: true } },
        },
      },
    },
  });

  return versions
    .filter((version) => {
      const suggestions = suggestOutfitNames(version.items.map((link) => link.item));
      return suggestions.includes(version.outfit.name);
    })
    .map((version) => ({ outfitId: version.outfit.id }));
}

/** Re-derive those names from the items as they are now. */
export async function refreshOutfitNames(
  userId: string,
  snapshots: readonly Snapshot[],
): Promise<void> {
  for (const { outfitId } of snapshots) {
    const outfit = await db.outfit.findUnique({
      where: { id: outfitId },
      select: {
        name: true,
        currentVersion: {
          select: {
            items: {
              select: {
                item: { select: { category: true, subcategory: true, colors: true } },
              },
            },
          },
        },
      },
    });

    const items = outfit?.currentVersion?.items.map((link) => link.item) ?? [];
    if (items.length === 0) continue;
    const next = await uniqueOutfitName(userId, items, outfitId);
    if (next === outfit?.name) continue;

    await db.outfit.update({ where: { id: outfitId }, data: { name: next } });
  }
}

/**
 * An auto-generated name that isn't already taken by another outfit.
 *
 * Two outfits sharing a top and bottom but differing in shoes would otherwise both be
 * called "Dark brown blouse + black jeans" — which is exactly the case in this catalog.
 * The suggestions run short to long, so falling through them naturally reaches for the
 * third piece to tell them apart. If every variant is taken the first is used anyway: a
 * duplicate name is worse than a mangled one, but not worse than refusing to save.
 */
export async function uniqueOutfitName(
  userId: string,
  items: readonly { category: Parameters<typeof suggestOutfitNames>[0][number]["category"]; subcategory: string | null; colors: string[] }[],
  excludeOutfitId?: string,
): Promise<string> {
  const suggestions = suggestOutfitNames(items);
  if (suggestions.length === 0) return "Untitled outfit";

  const taken = new Set(
    (
      await db.outfit.findMany({
        where: { userId, ...(excludeOutfitId ? { NOT: { id: excludeOutfitId } } : {}) },
        select: { name: true },
      })
    ).map((outfit) => outfit.name.toLowerCase()),
  );

  return suggestions.find((name) => !taken.has(name.toLowerCase())) ?? suggestions[0];
}
