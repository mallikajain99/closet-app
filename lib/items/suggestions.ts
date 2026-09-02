import "server-only";

import { db } from "@/lib/db";
import { SILHOUETTES, readSilhouette } from "@/lib/validation/item";

/**
 * Silhouette options offered in the form: a starter vocabulary plus whatever the user has
 * already used, so their own words rank alongside the defaults rather than being lost.
 */
export async function getSilhouetteSuggestions(userId: string): Promise<string[]> {
  const rows = await db.item.findMany({
    where: { userId },
    select: { attributes: true },
  });

  const used = new Set<string>();
  for (const row of rows) {
    for (const value of readSilhouette(row.attributes)) used.add(value);
  }

  // Starters first (familiar order), then anything the user invented.
  const starters = SILHOUETTES.filter(
    (starter) => ![...used].some((u) => u.toLowerCase() === starter.toLowerCase()),
  );
  return [...used, ...starters];
}
