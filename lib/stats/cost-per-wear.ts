/**
 * Cost-per-wear (spec §4).
 *
 * Always computed, never stored — it changes on every wear log, so a stored value is
 * guaranteed to go stale.
 */

/**
 * Cost per wear for a single item, in cents. Null only when no price was recorded.
 *
 * A never-worn item reports its **full purchase price**, not "no value". That is exactly
 * what it will cost per wear the first time it's worn, and it reads more intuitively than
 * a blank: a $200 coat you haven't worn yet is a $200-per-wear coat until you wear it.
 * Hence `max(wearCount, 1)` rather than a zero guard.
 */
export function costPerWearCents(
  priceCents: number | null | undefined,
  wearCount: number,
): number | null {
  if (priceCents == null) return null;
  return priceCents / Math.max(wearCount, 1);
}

export type OutfitCostInput = {
  priceCents: number | null | undefined;
  /** The item's OWN lifetime wear count, across every outfit — not this outfit's count. */
  wearCount: number;
};

/**
 * Cost per wear for an outfit: the **sum of its items' individual cost-per-wear values**.
 *
 * Deliberately not `total price ÷ times this outfit was worn`. Each garment earns its
 * value down independently across everything it's worn with, so a well-used pair of jeans
 * should contribute its low per-wear cost to every outfit it appears in — even a brand
 * new one. Dividing the outfit's total price by the outfit's own wear count would instead
 * make every new combination of well-worn pieces look expensive, which is backwards.
 *
 * Items with no recorded price contribute nothing to the sum, so the result is a lower
 * bound whenever `hasCompletePricing` is false. The UI should mark it as partial rather
 * than presenting it as exact.
 */
export function outfitCostPerWear(items: readonly OutfitCostInput[]): {
  costPerWearCents: number | null;
  hasCompletePricing: boolean;
  pricedItemCount: number;
  totalItemCount: number;
} {
  const priced = items.filter((item) => item.priceCents != null);
  const hasCompletePricing = priced.length === items.length;

  if (priced.length === 0) {
    return {
      costPerWearCents: null,
      hasCompletePricing,
      pricedItemCount: 0,
      totalItemCount: items.length,
    };
  }

  const sum = priced.reduce(
    (total, item) => total + (costPerWearCents(item.priceCents, item.wearCount) ?? 0),
    0,
  );

  return {
    costPerWearCents: sum,
    hasCompletePricing,
    pricedItemCount: priced.length,
    totalItemCount: items.length,
  };
}

/** Format cents as a display string, e.g. 1234 → "$12.34". Null renders as an em dash. */
export function formatCents(cents: number | null, currency = "USD"): string {
  if (cents == null) return "—";
  return new Intl.NumberFormat("en-US", {
    style: "currency",
    currency,
  }).format(cents / 100);
}
