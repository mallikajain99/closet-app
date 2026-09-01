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
  silhouette: optionalText,
  tagNames: z.array(z.string().trim().min(1).max(60)).max(20).default([]),
  originalImageKey: z.string().trim().min(1).optional(),
});

export type ItemInput = z.infer<typeof itemInputSchema>;

/** Collapse the loose attribute fields into the JSON column, dropping empties. */
export function buildAttributes(input: ItemInput) {
  const attributes: Record<string, string> = {};
  const fields = {
    sleeveLength: input.sleeveLength,
    formality: input.formality,
    material: input.material,
    pattern: input.pattern,
    silhouette: input.silhouette,
  };

  for (const [key, value] of Object.entries(fields)) {
    if (value) attributes[key] = value;
  }

  return attributes;
}
