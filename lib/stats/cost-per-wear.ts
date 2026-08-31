/**
 * Cost-per-wear (spec §4).
 *
 * Always computed, never stored — it changes on every wear log, so a stored value is
 * guaranteed to go stale.
 */

/**
 * Cost per wear in cents, or null when it cannot be computed.
 *
 * Returns null rather than Infinity for a never-worn item: "no cost-per-wear yet" is a
 * different statement from "infinitely expensive", and the UI should render it as "—"
 * rather than a number. Also null when no purchase price was recorded.
 */
export function costPerWearCents(
  priceCents: number | null | undefined,
  wearCount: number,
): number | null {
  if (priceCents == null || wearCount <= 0) return null;
  return priceCents / wearCount;
}

/**
 * Outfit-level cost-per-wear: the summed cost of the pieces divided by the number of
 * times that exact combination was worn (spec §4).
 *
 * Items with no recorded price contribute nothing, so the result is a lower bound when
 * the outfit contains unpriced pieces. `hasCompletePricing` lets the UI say so rather
 * than presenting a partial figure as exact.
 */
export function outfitCostPerWear(
  itemPricesCents: readonly (number | null | undefined)[],
  outfitWearCount: number,
): { costPerWearCents: number | null; hasCompletePricing: boolean } {
  const hasCompletePricing = itemPricesCents.every((p) => p != null);
  const total = itemPricesCents.reduce<number>((sum, p) => sum + (p ?? 0), 0);

  if (itemPricesCents.length === 0 || outfitWearCount <= 0 || total === 0) {
    return { costPerWearCents: null, hasCompletePricing };
  }

  return { costPerWearCents: total / outfitWearCount, hasCompletePricing };
}

/** Format cents as a display string, e.g. 1234 → "$12.34". */
export function formatCents(cents: number | null, currency = "USD"): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}
