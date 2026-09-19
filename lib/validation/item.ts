import { Category, ItemStatus, Season } from "@prisma/client";
import { z } from "zod";

/** Descriptive attributes (spec §1). Free-form vocabularies — stored as JSON on the item. */
export const SLEEVE_LENGTHS = [
  "sleeveless",
  "strapless",
  "short",
  "three-quarter",
  "long",
] as const;

export const FORMALITIES = ["casual", "simple", "smart", "dressy", "formal"] as const;

/**
 * Starter silhouette vocabulary. A garment often has several ("cropped" + "boxy"), so
 * this is a multi-value field rather than a single choice — and the list is open, seeded
 * here and extended by whatever the user types.
 */
export const SILHOUETTES = [
  "fitted",
  "relaxed",
  "oversized",
  "boxy",
  "cropped",
  "longline",
  "a-line",
  "straight",
  "wide-leg",
  "slim",
  "flared",
  "wrap",
  "tailored",
] as const;

/** Category → the slot it occupies in the outfit composite (spec §2). */
export const CATEGORY_LABELS: Record<Category, string> = {
  TOP: "Top",
  BOTTOM: "Bottom",
  DRESS: "Dress",
  OUTERWEAR: "Outerwear",
  SHOE: "Shoes",
  HAT: "Hat",
  BAG: "Bag",
  JEWELRY: "Jewelry",
  ACCESSORY: "Accessory",
};

/**
 * Plural labels for the catalog filter row, in body order rather than alphabetical —
 * scanning head-to-toe matches how you picture an outfit.
 */
export const CATEGORY_PLURAL: Record<Category, string> = {
  TOP: "Tops",
  BOTTOM: "Bottoms",
  DRESS: "Dresses",
  OUTERWEAR: "Outerwear",
  SHOE: "Shoes",
  HAT: "Hats",
  BAG: "Bags",
  JEWELRY: "Jewelry",
  ACCESSORY: "Accessories",
};

export const CATEGORY_ORDER: Category[] = [
  "TOP",
  "BOTTOM",
  "DRESS",
  "OUTERWEAR",
  "SHOE",
  "HAT",
  "BAG",
  "JEWELRY",
  "ACCESSORY",
];

export const STATUS_LABELS: Record<ItemStatus, string> = {
  ACTIVE: "In closet",
  LAUNDRY: "In the wash",
  REPAIR: "Needs mending",
  DONATED: "Donated",
  SOLD: "Sold",
};

export const SEASON_LABELS: Record<Season, string> = {
  SPRING: "Spring",
  SUMMER: "Summer",
  FALL: "Fall",
  WINTER: "Winter",
};

/**
 * Descriptive fields that only make sense for some categories.
 *
 * A handbag has no sleeve length and a necklace has no silhouette. Offering them anyway
 * invites junk data that then shows up as a filter chip matching one nonsensical item,
 * and it makes the form longer than it needs to be on a phone.
 *
 * The form hides an inapplicable field and the server drops any value for it, so a stale
 * submission — or changing an item's category after the fact — can't leave a bag with a
 * sleeve length attached.
 */
export type ConditionalField = "size" | "sleeveLength" | "silhouette";

export const FIELD_CATEGORIES: Record<ConditionalField, readonly Category[]> = {
  // Bags, jewelry and loose accessories are one-size things.
  size: ["TOP", "BOTTOM", "DRESS", "OUTERWEAR", "SHOE", "HAT"],
  sleeveLength: ["TOP", "DRESS", "OUTERWEAR"],
  silhouette: ["TOP", "BOTTOM", "DRESS", "OUTERWEAR"],
};

/** With no category chosen yet, nothing is hidden — the form narrows as you pick. */
export function fieldApplies(field: ConditionalField, category: Category | null | undefined) {
  if (!category) return true;
  return FIELD_CATEGORIES[field].includes(category);
}

/**
 * Silhouette words worth offering per category.
 *
 * "Wide-leg" is meaningless on a blouse and "cropped" rarely helps on trousers. The list
 * is still open — anything typed is kept — this only decides what gets suggested.
 */
export const SILHOUETTES_BY_CATEGORY: Partial<Record<Category, readonly string[]>> = {
  TOP: ["fitted", "relaxed", "oversized", "boxy", "cropped", "longline", "wrap", "slim"],
  OUTERWEAR: ["fitted", "relaxed", "oversized", "boxy", "cropped", "longline", "tailored"],
  BOTTOM: ["straight", "wide-leg", "slim", "flared", "a-line", "tailored", "relaxed", "cropped"],
  DRESS: ["fitted", "relaxed", "oversized", "a-line", "wrap", "straight", "longline", "tailored"],
};

/** Trim, then treat an empty string as absent — HTML forms submit "" for untouched fields. */
const optionalText = z
  .string()
  .trim()
  .max(200)
  .optional()
  .transform((value) => (value ? value : undefined));

/**
 * Price arrives as a decimal string ("48.50") and is stored as integer cents.
 * Floats would accumulate rounding error across the cost-per-wear rollups.
 */
const priceToCents = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;
    const cleaned = value.replace(/[$,\s]/g, "");
    const parsed = Number(cleaned);
    if (!Number.isFinite(parsed) || parsed < 0) {
      ctx.addIssue({ code: "custom", message: "Enter a price like 48.50" });
      return z.NEVER;
    }
    return Math.round(parsed * 100);
  });

const optionalDate = z
  .string()
  .trim()
  .optional()
  .transform((value, ctx) => {
    if (!value) return undefined;
    const parsed = new Date(value);
    if (Number.isNaN(parsed.getTime())) {
      ctx.addIssue({ code: "custom", message: "Not a valid date" });
      return z.NEVER;
    }
    return parsed;
  });

export const itemInputSchema = z.object({
  name: z.string().trim().min(1, "Give the item a name").max(200),
  category: z.enum(Category),
  subcategory: optionalText,
  brand: optionalText,
  size: optionalText,
  colors: z.array(z.string().trim().min(1)).max(8).default([]),
  seasons: z.array(z.enum(Season)).default([]),
  priceCents: priceToCents,
  purchaseDate: optionalDate,
  sourceUrl: z
    .string()
    .trim()
    .url("Not a valid link")
    .optional()
    .or(z.literal("").transform(() => undefined)),
  status: z.enum(ItemStatus).default("ACTIVE"),
  conditionNote: optionalText,
  returnByDate: optionalDate,
  sleeveLength: optionalText,
  formality: optionalText,
  material: optionalText,
  pattern: optionalText,
  silhouette: z.array(z.string().trim().min(1).max(60)).max(10).default([]),
  tagNames: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  originalImageKey: z.string().trim().min(1).optional(),
});

export type ItemInput = z.infer<typeof itemInputSchema>;

/** Collapse the loose attribute fields into the JSON column, dropping empties. */
export function buildAttributes(
  input: ItemInput,
  overrides: Partial<Record<"material" | "pattern", string | undefined>> = {},
) {
  const attributes: Record<string, string | string[]> = {};
  const single = {
    // Dropped outright when the category has no sleeves, rather than trusted from the
    // form: the field is hidden client-side, so anything arriving here is stale state
    // or a hand-made request.
    sleeveLength: fieldApplies("sleeveLength", input.category) ? input.sleeveLength : undefined,
    formality: input.formality,
    material: overrides.material ?? input.material,
    pattern: overrides.pattern ?? input.pattern,
  };

  for (const [key, value] of Object.entries(single)) {
    if (value) attributes[key] = value;
  }

  if (input.silhouette.length > 0 && fieldApplies("silhouette", input.category)) {
    attributes.silhouette = input.silhouette;
  }

  return attributes;
}

/** Attributes come back from JSON untyped; silhouette is the one array among them. */
export function readSilhouette(attributes: unknown): string[] {
  if (!attributes || typeof attributes !== "object") return [];
  const value = (attributes as Record<string, unknown>).silhouette;
  if (Array.isArray(value)) return value.filter((v): v is string => typeof v === "string");
  // Tolerate rows written before silhouette became multi-value.
  return typeof value === "string" && value ? [value] : [];
}
