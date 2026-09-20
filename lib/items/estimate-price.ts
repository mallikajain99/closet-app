/**
 * Estimate what a garment cost, when the user never recorded a price.
 *
 * Cost-per-wear is the number this app exists to report, and it is undefined without a
 * price. Asking for one at intake would be the accurate route and would also stop the
 * closet being catalogued at all — so every item gets an estimate on save, flagged as
 * an estimate (`Item.priceEstimated`) so a guess is never mistaken for a fact and can
 * be overwritten by a real figure at any time.
 *
 * Shared by the intake path and `scripts/estimate-prices.ts`, so a bulk re-run and a
 * freshly uploaded item can never price the same garment differently.
 */

export type PriceableItem = {
  brand: string | null;
  category: string;
  subcategory: string | null;
  attributes: unknown;
};

/**
 * Brand multipliers against a mid-market baseline (Mango ≈ 1.0).
 *
 * Calibrated against the three prices already in the catalog — an Abercrombie sweater at
 * $45, Banana Republic at $40, Mango at $40 — which sit near sale price rather than full
 * retail. Estimating at list price would have overstated the whole closet by roughly a
 * third and quietly inflated every cost-per-wear.
 */
const BRAND_TIER: Record<string, number> = {
  shein: 0.35,
  "port authority": 0.55,
  bershka: 0.6,
  "h&m": 0.6,
  "old navy": 0.6,
  "american eagle": 0.8,
  gap: 0.85,
  zara: 0.95,
  mango: 1.0,
  "abercrombie & fitch": 1.1,
  "ann taylor": 1.1,
  kasper: 1.1,
  columbia: 1.0,
  nike: 1.15,
  "banana republic": 1.2,
  heartloom: 1.2,
  foxcroft: 1.3,
  madewell: 1.3,
  // Outdoor technical brands price well above high-street for the same garment type.
  patagonia: 1.5,
  // Traditional Austrian/Bavarian outfitter — suede trachten pieces are not high-street.
  "berwin & wolff": 2.6,
};

/** Unbranded pieces are assumed high-street rather than designer. */
const DEFAULT_TIER = 0.8;

/** Baseline price in dollars for each garment type, at tier 1.0. */
const GARMENT_BASE: Record<string, number> = {
  "t-shirt": 15,
  top: 20,
  shirt: 30,
  blouse: 32,
  hoodie: 32,
  sweater: 38,
  sweaters: 38,
  cardigan: 38,
  vest: 40,
  overshirt: 42,
  shorts: 30,
  sandals: 35,
  sweatshirt: 35,
  skirt: 31,
  // Set from the user's own figures — jeans $65, trousers $40, skirts $25 — which describe
  // her (unbranded) pieces. These bases are quoted at tier 1.0, so they are those numbers
  // divided by the 0.8 unbranded tier; a mid-market branded equivalent lands higher, which
  // is the intent.
  trousers: 50,
  pants: 50,
  flats: 40,
  leggings: 40,
  sneakers: 45,
  heels: 55,
  loafers: 55,
  jacket: 65,
  jeans: 81,
  boots: 70,
  blazer: 70,
  coat: 90,

  // Added when dresses, tanks and accessories entered the closet. Without a base each
  // fell to its category default, which priced a floor-length gown and a jersey mini
  // the same — the single number a category fallback can offer.
  camisole: 25,
  bodysuit: 35,
  "bike shorts": 28,
  "tank top": 18,
  "halter top": 22,
  "mini dress": 40,
  "shift dress": 45,
  "sheath dress": 50,
  "midi dress": 55,
  "sweater dress": 55,
  "maxi dress": 65,
  gown: 110,
  "midi skirt": 36,
  clogs: 60,
  mules: 55,
  "mary janes": 50,
  cap: 22,
  clutch: 40,
  "shoulder bag": 60,
  tote: 55,
};

/** Every category needs one: without a SHOE entry, every shoe silently took the $30 default. */
const CATEGORY_FALLBACK: Record<string, number> = {
  TOP: 28,
  BOTTOM: 35,
  DRESS: 50,
  OUTERWEAR: 55,
  SHOE: 50,
  HAT: 20,
  BAG: 45,
  JEWELRY: 25,
  ACCESSORY: 25,
};

/** Fabric moves price more than almost anything else at the same brand. */
const MATERIAL_FACTOR: Array<[string, number]> = [
  // Listed before "leather": `includes` matches the first entry, and faux leather is a
  // mid-market fabric, not the premium the real hide commands.
  ["faux leather", 1.3],
  ["suede", 2.2],
  ["leather", 2.2],
  ["silk", 1.5],
  ["tweed", 1.3],
  ["wool", 1.15],
  ["linen", 1.1],
  ["satin", 1.05],
  ["corduroy", 1.05],
  ["puffer", 1.2],
  // Named only so they aren't silently treated as a premium fabric by a later addition.
  ["fleece", 1.0],
  ["nylon", 1.0],
  ["webbing", 0.9],
];

function estimateDollars(item: PriceableItem) {
  const tier = BRAND_TIER[item.brand?.trim().toLowerCase() ?? ""] ?? DEFAULT_TIER;
  const base =
    GARMENT_BASE[item.subcategory?.trim().toLowerCase() ?? ""] ??
    CATEGORY_FALLBACK[item.category] ??
    30;

  const material = String(
    ((item.attributes ?? {}) as Record<string, unknown>).material ?? "",
  ).toLowerCase();

  // Leather and suede are a premium on a garment and the default on a shoe — the shoe
  // base prices already assume them. Applying the garment multiplier to footwear put
  // Columbia hiking boots at $155 and plain suede sneakers at $80.
  const premiumHide = /leather|suede/.test(material);
  const factor =
    item.category === "SHOE" && premiumHide
      ? 1
      : (MATERIAL_FACTOR.find(([word]) => material.includes(word))?.[1] ?? 1);

  // Round to the nearest $5 — false precision would imply a confidence these don't have.
  return Math.max(5, Math.round((base * tier * factor) / 5) * 5);
}

/** The estimate in cents, matching `Item.priceCents`. */
export function estimatePriceCents(item: PriceableItem): number {
  return estimateDollars(item) * 100;
}
