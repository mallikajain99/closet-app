import { CATEGORY_SLOT } from "@/lib/outfits/slots";
import type { Category } from "@prisma/client";

export type NameableItem = {
  category: Category;
  subcategory: string | null;
  colors: string[];
};

/**
 * Which pieces carry an outfit's identity, in the order they should be named.
 *
 * Top and bottom first: they are what someone pictures when they think of an outfit.
 * Outerwear and shoes are qualifiers — worth naming only when there aren't two core
 * pieces to name, otherwise every name runs to four garments and none of them read.
 */
const NAMING_PRIORITY: Category[] = ["DRESS", "TOP", "BOTTOM", "OUTERWEAR", "SHOE"];

/** "sage green sweater", "black jeans" — the short way you'd describe a piece aloud. */
function describe(item: NameableItem, withColor = true): string {
  const kind = item.subcategory?.trim() || CATEGORY_SLOT[item.category].label.toLowerCase();
  const color = item.colors[0]?.trim();
  return withColor && color ? `${color} ${kind}`.toLowerCase() : kind.toLowerCase();
}

const sentence = (value: string) =>
  value ? value.charAt(0).toUpperCase() + value.slice(1) : value;

function inNamingOrder(items: readonly NameableItem[]): NameableItem[] {
  return [...items].sort(
    (a, b) => NAMING_PRIORITY.indexOf(a.category) - NAMING_PRIORITY.indexOf(b.category),
  );
}

/**
 * Suggested names for an outfit, best first.
 *
 * Offered rather than imposed: naming is the one part of saving an outfit that the app
 * cannot infer well, and making it mandatory turns a two-tap action into a writing task.
 * The variants differ in how much detail they carry, because "Sage green sweater + black
 * jeans" and "Sweater + jeans" suit different people — and the same person on different
 * days.
 *
 * Returns an empty array for an empty outfit; duplicates are removed, so a one-piece
 * outfit yields one suggestion rather than three near-identical ones.
 */
export function suggestOutfitNames(items: readonly NameableItem[]): string[] {
  if (items.length === 0) return [];

  const ordered = inNamingOrder(items);
  // A dress already implies the whole outfit, so it doesn't need a second core piece.
  const coreCount = ordered[0]?.category === "DRESS" ? 1 : 2;
  const core = ordered.slice(0, coreCount);

  const suggestions = [
    core.map((item) => describe(item)).join(" + "),
    core.map((item) => describe(item, false)).join(" + "),
    ordered
      .slice(0, 3)
      .map((item) => describe(item))
      .join(" + "),
  ];

  const seen = new Set<string>();
  const unique: string[] = [];
  for (const suggestion of suggestions) {
    const value = sentence(suggestion.trim());
    if (!value || seen.has(value.toLowerCase())) continue;
    seen.add(value.toLowerCase());
    unique.push(value);
  }
  return unique;
}

/** The name to save when the user leaves the field blank. */
export function defaultOutfitName(items: readonly NameableItem[]): string {
  return suggestOutfitNames(items)[0] ?? "Untitled outfit";
}
