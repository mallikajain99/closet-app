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
export async function refreshOutfitNames(snapshots: readonly Snapshot[]): Promise<void> {
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
    const [next] = suggestOutfitNames(items);
    if (!next || next === outfit?.name) continue;

    await db.outfit.update({ where: { id: outfitId }, data: { name: next } });
  }
}
