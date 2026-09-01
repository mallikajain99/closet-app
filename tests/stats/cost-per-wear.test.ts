import { describe, expect, it } from "vitest";

import {
  costPerWearCents,
  formatCents,
  outfitCostPerWear,
} from "@/lib/stats/cost-per-wear";

describe("costPerWearCents", () => {
  it("divides price by lifetime wears", () => {
    expect(costPerWearCents(20000, 10)).toBe(2000); // $200 over 10 wears = $20
  });

  it("reports the full price for a never-worn item", () => {
    // Not null, and not Infinity. A $200 coat you haven't worn yet is a $200-per-wear
    // coat — which is exactly what it will cost the first time you wear it.
    expect(costPerWearCents(20000, 0)).toBe(20000);
  });

  it("gives the same value before the first wear and after it", () => {
    expect(costPerWearCents(20000, 0)).toBe(costPerWearCents(20000, 1));
  });

  it("returns null only when no price was recorded", () => {
    expect(costPerWearCents(null, 5)).toBeNull();
    expect(costPerWearCents(undefined, 0)).toBeNull();
  });

  it("treats a free item as costing nothing per wear", () => {
    expect(costPerWearCents(0, 3)).toBe(0);
  });
});

describe("outfitCostPerWear", () => {
  it("sums the items' individual cost-per-wear values", () => {
    const result = outfitCostPerWear([
      { priceCents: 10000, wearCount: 10 }, // $10/wear
      { priceCents: 6000, wearCount: 2 }, //  $30/wear
      { priceCents: 5000, wearCount: 5 }, //  $10/wear
    ]);

    expect(result.costPerWearCents).toBe(5000); // $50
    expect(result.hasCompletePricing).toBe(true);
  });

  it("does NOT divide the outfit's total price by the outfit's wear count", () => {
    // The rule that matters. A brand-new pairing of two heavily-worn favourites should
    // read as cheap, because both garments have already earned their cost down.
    // Total price is $500; under the rejected formula a first-time outfit would show
    // $500/wear. Under the correct rule it shows $10.
    const wellWornPieces = [
      { priceCents: 30000, wearCount: 100 }, // $3/wear
      { priceCents: 20000, wearCount: 200 }, // $1/wear
    ];

    const result = outfitCostPerWear(wellWornPieces);

    expect(result.costPerWearCents).toBe(400); // $4, not $500
    expect(result.costPerWearCents).toBeLessThan(50000);
  });

  it("counts a never-worn piece at its full price", () => {
    const result = outfitCostPerWear([
      { priceCents: 8000, wearCount: 0 }, // $80 — never worn
      { priceCents: 4000, wearCount: 20 }, // $2/wear
    ]);

    expect(result.costPerWearCents).toBe(8200);
  });

  it("flags partial pricing and returns a lower bound", () => {
    const result = outfitCostPerWear([
      { priceCents: 10000, wearCount: 10 }, // $10/wear
      { priceCents: null, wearCount: 4 }, //  unknown
    ]);

    expect(result.costPerWearCents).toBe(1000);
    expect(result.hasCompletePricing).toBe(false);
    expect(result.pricedItemCount).toBe(1);
    expect(result.totalItemCount).toBe(2);
  });

  it("returns null when nothing in the outfit has a price", () => {
    const result = outfitCostPerWear([
      { priceCents: null, wearCount: 3 },
      { priceCents: undefined, wearCount: 1 },
    ]);

    expect(result.costPerWearCents).toBeNull();
    expect(result.hasCompletePricing).toBe(false);
  });

  it("handles an empty outfit", () => {
    const result = outfitCostPerWear([]);
    expect(result.costPerWearCents).toBeNull();
    expect(result.totalItemCount).toBe(0);
  });
});

describe("formatCents", () => {
  it("formats cents as currency", () => {
    expect(formatCents(1234)).toBe("$12.34");
  });

  it("renders an em dash for an unknown value", () => {
    expect(formatCents(null)).toBe("—");
  });
});
