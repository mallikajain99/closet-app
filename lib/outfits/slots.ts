import { CATEGORY_EXTENT } from "@/lib/images/normalize";
import type { Category, Slot } from "@prisma/client";

/**
 * Where each category sits in an outfit, and how the garment is laid out there.
 *
 * `height` and `centre` are fractions of the figure's height — not of the canvas. They
 * come from the Phase 2.5 calibration (see PLAN.md §1.1): the catalog grid wants a
 * garment to fill its tile, a body wants it at body proportions, and one set of numbers
 * cannot serve both.
 *
 * `z` is paint order, back to front. A top goes over a waistband, and — because the
 * upper layers are laid side by side rather than stacked — over its own outerwear.
 *
 * Note: `scripts/outfit-preview.ts` has its own `COMPOSITE_GEOMETRY` and no longer
 * reads this table — it still uses the pre-landmark `centre` model, so it is a stale
 * calibration tool rather than a second renderer of this layout.
 */
export type SlotLayout = {
  slot: Slot;
  label: string;
  /** Fraction of the figure's height the garment occupies. */
  height: number;
  /**
   * The body landmark the garment hangs from, and which of its edges meets it.
   *
   * Anchoring by landmark rather than by centre is what keeps garments aligned with
   * each other: every top starts at the shoulder line and every bottom starts at the
   * waist, so a longer top extends further down instead of pushing its own shoulders
   * up. Centre-anchoring moved both edges whenever a length changed, which is why
   * tops and trousers met in a different place for every combination.
   */
  anchor: number;
  edge: "top" | "bottom";
  /**
   * Where the garment sits across the figure.
   *
   * Almost everything is worn on the body's centre line. A bag is carried beside it,
   * and stacking one down the middle reads as a garment rather than an accessory.
   */
  align?: "centre" | "side";
  /**
   * Size this category by how wide it should draw, not how tall.
   *
   * Every other garment is sized by height because that is what a body sets: a top
   * ends where it ends. A belt is the opposite — it is photographed lying flat at
   * roughly 3:1, so its height is an artefact of the photograph and its *width* is the
   * thing with a right answer, namely a waist. Picking a height and hoping produced a
   * belt that read as a bracelet at 0.06 and overshot the trousers at 0.10.
   *
   * Needs the measured render to apply; without one the height above is used.
   */
  widthTarget?: number;
  z: number;
};

/** Body landmarks, crown 0 to soles 1. */
export const SHOULDER = 0.17;
export const WAIST = 0.45;
export const FLOOR = 1;

/**
 * Set from where a garment actually falls on a body, crown 0 to soles 1:
 * shoulders 0.17, waist 0.45, hip 0.52, knee 0.73, ankle 0.95.
 *
 * An earlier set was derived by eye against a placeholder figure and was badly out — a
 * cardigan spanned 0.16 to 0.67, shoulders to mid-thigh, while jeans ran 0.57 to 0.97,
 * starting at the hip and stopping short. That produced a dominant top over stunted
 * legs, which is what "the rendering looks off" was pointing at.
 *
 * Categories deliberately overlap: a top covers the waistband, shoes overlap the hem.
 * The paint order below decides what wins.
 */
export const CATEGORY_SLOT: Record<Category, SlotLayout> = {
  // Sits on the head.
  HAT: { slot: "HEAD", label: "Hat", height: 0.12, anchor: 0.02, edge: "top", z: 60 },
  JEWELRY: { slot: "JEWELRY", label: "Jewelry", height: 0.06, anchor: SHOULDER, edge: "top", z: 70 },
  // Anchored at the waist, not below the shoulder where this used to sit. The
  // accessories that actually exist here are belts, and a belt is worn over both the
  // top and the waistband — hence the paint order above them but below shoes and bags.
  // A scarf would want the neck; when one arrives it needs an anchor override rather
  // than a second guess at one number for both.
  // 0.10 is chosen for the *width* it produces, not the height: a belt is photographed
  // lying flat at roughly 3:1, so this draws it about 0.30 of the figure wide — a waist,
  // give or take, against trousers that draw at 0.35. At the anatomical 0.06 it came out
  // 0.18 wide and read as a bracelet lying on the jeans. Sizing by height is wrong for
  // anything this wide and flat; if a second shape of accessory arrives, this table
  // needs a width target rather than another compromise.
  ACCESSORY: {
    slot: "OTHER",
    label: "Accessory",
    height: 0.06,
    // Back to the size it started at, which was right. Widening it was me fixing the
    // wrong thing: the belt didn't look small, it looked wrong *on top of an untucked
    // shirt*, which is a paint-order problem.
    widthTarget: 0.18,
    anchor: WAIST,
    edge: "top",
    // Behind the upper layers, over the waistband. A belt worn under an untucked shirt
    // is not visible, and drawing it across the shirt's body was the thing that looked
    // off. Where a top is cropped or tucked — or spread aside, as layered tops are —
    // the belt shows at the waist, which is where it should be.
    z: 22,
  },

  // Everything worn on the upper body hangs from the shoulders, so they all share one
  // anchor and only their hems differ.
  // Outerwear paints *behind* the top, which is backwards as clothing and right as a
  // flat lay: the two are laid side by side rather than stacked, and the piece worn
  // next to the skin is the one you want legible where they meet. Still over the
  // waistband, so the pair reads as one torso above the trousers.
  OUTERWEAR: { slot: "OUTER", label: "Outerwear", height: 0.42, anchor: SHOULDER, edge: "top", z: 25 },
  // A dress is its own slot, not the top's: a top or sweater is routinely worn over
  // one, and sharing a slot made the two mutually exclusive in the builder. It paints
  // behind the top for the same reason, since the top is the layer worn over it.
  DRESS: { slot: "DRESS", label: "Dress", height: 0.58, anchor: SHOULDER, edge: "top", z: 28 },
  TOP: { slot: "TOP", label: "Top", height: 0.31, anchor: SHOULDER, edge: "top", z: 30 },

  // Everything worn on the lower body hangs from the waist.
  BOTTOM: { slot: "BOTTOM", label: "Bottom", height: 0.5, anchor: WAIST, edge: "top", z: 20 },

  // Shoes stand on the floor, so it is their *bottom* edge that is fixed. Deliberately
  // larger than anatomy: a foot is ~5% of height seen front-on, but these photos show a
  // whole shoe from the front, so the true figure renders as a speck.
  SHOE: { slot: "SHOES", label: "Shoes", height: 0.13, anchor: FLOOR, edge: "bottom", z: 50 },

  // Carried at the hip, off to one side.
  BAG: { slot: "BAG", label: "Bag", height: 0.18, anchor: 0.46, edge: "top", align: "side", z: 55 },
};

/**
 * The slots the builder offers, head to toe.
 *
 * A slot with nothing to put in it is hidden at render time rather than listed here, so
 * this can stay the full set: an empty carousel reads as broken, but a missing one just
 * looks like a shorter form.
 */
export const BUILDER_SLOTS = [
  { slot: "HEAD" as Slot, label: "Hat", categories: ["HAT"] as Category[] },
  { slot: "OUTER" as Slot, label: "Outerwear", categories: ["OUTERWEAR"] as Category[] },
  { slot: "DRESS" as Slot, label: "Dress", categories: ["DRESS"] as Category[] },
  { slot: "TOP" as Slot, label: "Top", categories: ["TOP"] as Category[] },
  { slot: "BOTTOM" as Slot, label: "Bottom", categories: ["BOTTOM"] as Category[] },
  { slot: "SHOES" as Slot, label: "Shoes", categories: ["SHOE"] as Category[] },
  { slot: "BAG" as Slot, label: "Bag", categories: ["BAG"] as Category[] },
  { slot: "OTHER" as Slot, label: "Accessory", categories: ["ACCESSORY"] as Category[] },
] as const;

/**
 * Length overrides, because one number per category is not enough.
 *
 * A mini skirt rendered waist-to-ankle like trousers, and a cropped cardigan rendered
 * like a coat. The category says where a garment starts; only the garment itself says
 * where it ends — and it does say, in its subcategory, silhouette and name: "wrap mini
 * skirt", "cropped", "longline coat".
 *
 * Matched most specific first, against subcategory + silhouette + name. A garment that
 * matches nothing keeps its category default, so this only ever sharpens the guess.
 */
const LENGTH_OVERRIDES: Array<{
  match: RegExp;
  categories: Category[];
  height: number;
}> = [
  // Only the hem moves: a mini skirt still hangs from the waist, it just stops sooner.
  // Waist 0.45, mid-thigh 0.62, knee 0.73, calf 0.85, ankle 0.95.
  { match: /\bshorts\b/i, categories: ["BOTTOM"], height: 0.17 },
  { match: /\bmini\b/i, categories: ["BOTTOM"], height: 0.27 },
  { match: /\bmidi\b/i, categories: ["BOTTOM"], height: 0.38 },
  { match: /\bmaxi\b/i, categories: ["BOTTOM"], height: 0.5 },
  // A skirt with no stated length: knee, the safe middle.
  { match: /\bskirt\b/i, categories: ["BOTTOM"], height: 0.28 },

  // Cropped stops above the waist; longline passes the hip.
  { match: /\bcropped\b/i, categories: ["TOP"], height: 0.22 },
  { match: /\bcropped\b/i, categories: ["OUTERWEAR"], height: 0.26 },
  { match: /\blongline|long coat|trench|maxi\b/i, categories: ["OUTERWEAR"], height: 0.68 },
  { match: /\bcoat\b/i, categories: ["OUTERWEAR"], height: 0.58 },
  // Dresses hang from the shoulder, so these are shoulder-to-hem: 0.4 stops above the
  // knee, 0.58 below it, 0.78 at the ankle.
  { match: /\bmini\b/i, categories: ["DRESS"], height: 0.4 },
  { match: /\bmidi\b/i, categories: ["DRESS"], height: 0.58 },
  // Grouped, not `\bmaxi|gown\b` — in an alternation the word boundaries bind to the
  // first and last branch only, so the unbracketed form anchors neither middle term.
  { match: /\b(maxi|gown)\b/i, categories: ["DRESS"], height: 0.78 },
  // None of these says its length, but each has one by convention: a knit dress is cut
  // short, a shift or sheath ends around the knee, and a gown reaches the floor.
  // Without them they all fall to the category default.
  { match: /\b(sweater|knit|shift|sheath) dress\b/i, categories: ["DRESS"], height: 0.5 },
];


/** Everything about a garment that bears on how long it is. */
export type LayoutSubject = {
  category: Category;
  subcategory?: string | null;
  name?: string | null;
  silhouette?: readonly string[];
  /**
   * Measured size of the garment inside its 1024px render.
   *
   * Only the ratio is used, and only to match one shoulder width against another —
   * lengths still come from the landmark table, not from the photograph.
   */
  renderWidth?: number | null;
  renderHeight?: number | null;
};

/**
 * Where this particular garment sits: its landmark, plus its own length.
 *
 * Returns the top edge rather than the centre, because the landmark is what must stay
 * put. A shorter hem moves the hem, never the shoulders.
 */
export function layoutFor(subject: LayoutSubject): { height: number; top: number } {
  const base = CATEGORY_SLOT[subject.category];
  const text = [subject.subcategory, subject.name, ...(subject.silhouette ?? [])]
    .filter(Boolean)
    .join(" ");

  const override = LENGTH_OVERRIDES.find(
    (rule) => rule.categories.includes(subject.category) && rule.match.test(text),
  );

  const height = override?.height ?? base.height;
  const top = base.edge === "top" ? base.anchor : base.anchor - height;

  return { height, top };
}

/** Paint order for a set of chosen categories, back to front. */
export function byPaintOrder<T extends { category: Category }>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => CATEGORY_SLOT[a.category].z - CATEGORY_SLOT[b.category].z);
}



/**
 * The largest gap allowed between two stacked garments, as a fraction of the figure.
 *
 * Anatomically a gap is often correct — shorts really do leave bare leg above the
 * shoe. But with no body rendered behind them, a quarter-figure void reads as a broken
 * layout rather than as legs, and the outfits that look right are precisely the ones
 * whose pieces happen to overlap.
 */
const MAX_GAP = 0.04;

/**
 * How far a shoe may ride up over the hem above it, as a fraction of the figure.
 *
 * Anatomically the overlap is large — trousers break over the shoe, and a shoe box drawn
 * from the ankle to the floor sits mostly behind the hem. On a body that reads correctly
 * because the leg is there. With nothing behind them the shoes look stuck to the middle
 * of the trouser leg rather than standing under it, so the overlap is capped at a token
 * amount that still reads as contact.
 */
const MAX_SHOE_OVERLAP = 0.03;

/**
 * How far a shoulder width may be scaled to match the layer it sits against.
 *
 * Generous, because the mismatch being corrected is large, but bounded: an unclamped
 * ratio would let one bad cutout resize the garment beside it into the frame edge.
 */
const SHOULDER_MATCH_LIMIT = { min: 0.6, max: 1.8 };

/** The width this garment will actually be drawn at, given the height it is laid out to. */
function drawnWidth(subject: LayoutSubject, height: number): number | null {
  if (!subject.renderWidth || !subject.renderHeight) return null;
  return height * (subject.renderWidth / subject.renderHeight);
}

/**
 * Bring a layered top and outerwear to a common shoulder width.
 *
 * Heights come from the landmark table, so a garment's drawn *width* is whatever its
 * photograph's aspect ratio makes it — across the real closet that runs from 0.16 to
 * 0.46 of the figure, a factor of nearly three. Worn together, the narrow one looks
 * like it belongs to a child. Scaling is applied around the shoulder line, so the hem
 * moves and the anchor does not, exactly as a length override would.
 *
 * Mutates the spans in place; the caller owns them and has not used the heights yet.
 */
function matchShoulders<T extends LayoutSubject>(
  spans: Array<{ item: T; top: number; height: number }>,
): void {
  // Every shoulder-hung garment except a dress, not just the first of each kind: two
  // sweaters layered together mismatch exactly the way a sweater and a cardigan do.
  // Dresses are excluded because matching works by scaling, and scaling a dress to a
  // shirt's shoulder would drag its hem with it — a dress's length is stated by its own
  // length rule, which is not a number to overrule for the sake of a shoulder.
  const layers = spans.filter(
    (span) => span.item.category === "TOP" || span.item.category === "OUTERWEAR",
  );
  if (layers.length < 2) return;

  const measured = layers.map((span) => drawnWidth(span.item, span.height));
  if (measured.some((width) => !width)) return;
  const widths = measured as number[];

  // The *geometric* mean, so no garment is treated as the authority — none is more
  // correctly photographed than the others, they are just different shapes. It has to
  // be geometric: an arithmetic mean sits nearer the larger widths, so correcting a 3×
  // mismatch would shrink the wide garment by a third while asking the narrow one to
  // nearly double. This splits the ratio evenly, each moving by the same factor.
  const target = Math.exp(
    widths.reduce((sum, width) => sum + Math.log(width), 0) / widths.length,
  );

  layers.forEach((span, index) => {
    const scale = Math.min(
      SHOULDER_MATCH_LIMIT.max,
      Math.max(SHOULDER_MATCH_LIMIT.min, target / widths[index]),
    );
    span.height *= scale;
  });
}

/**
 * How far each layered upper garment moves off the centre line, as a fraction of the
 * frame's width.
 *
 * Worn, a cardigan covers most of the shirt under it — honest, and useless here: the
 * outfit reads as one garment and the piece underneath may as well not be in it. Flat-lay
 * styling solves this by laying the outer layer off to one side, overlapping rather than
 * hiding. Small enough that the pair still reads as one torso.
 */
const LAYER_SPREAD = 0.13;

/**
 * The garments that hang from the shoulder line, back to front.
 *
 * These are the ones that can cover each other, so these are the ones spread apart.
 * Jewelry shares the anchor but is an accessory sitting on top of everything, not a
 * layer competing for the same space.
 */
const LAYERED_CATEGORIES: Category[] = ["OUTERWEAR", "DRESS", "TOP"];

export type PlacedGarment<T> = {
  item: T;
  top: number;
  height: number;
  /** Signed fraction of the frame's width to shift by; 0 for anything on the centre line. */
  offsetX: number;
};

/**
 * Lay out a whole outfit: anatomical positions, then gaps closed, then fitted to frame.
 *
 * Done for the set rather than per garment because closing a gap moves everything below
 * it — a decision that cannot be made looking at one piece at a time.
 */
export function composeOutfit<T extends LayoutSubject>(
  items: readonly T[],
): { placed: PlacedGarment<T>[]; frame: { top: number; bottom: number } } {
  if (items.length === 0) return { placed: [], frame: { top: 0, bottom: 1 } };

  const spans = items
    .map((item) => ({ item, ...layoutFor(item), offsetX: 0 }))
    .sort((a, b) => a.top - b.top);

  // Width-targeted categories get their height back-computed from the render's aspect.
  // Done before anything measures these heights, like the shoulder matching below.
  for (const span of spans) {
    const target = CATEGORY_SLOT[span.item.category].widthTarget;
    const { renderWidth, renderHeight } = span.item;
    if (!target || !renderWidth || !renderHeight) continue;
    span.height = target * (renderHeight / renderWidth);
  }

  // Before anything measures these heights: gap-closing, the frame, and the box-fit
  // clamp all read them, so resizing afterwards would crop the garment it just grew.
  matchShoulders(spans);

  // Spread the shoulder-hung layers apart, but only when there is more than one — a
  // lone top belongs on the centre line. Laid out back to front, left to right, so the
  // piece in front sits rightmost the way a flat lay is arranged. Three layers (a
  // cardigan, a dress and a top over it) put the middle one on the centre line.
  // Every shoulder-hung garment, in paint order back to front, not one per category:
  // layering two sweaters is as ordinary as layering a sweater under a cardigan.
  const layered = spans
    .filter((span) => LAYERED_CATEGORIES.includes(span.item.category))
    .sort(
      (a, b) => CATEGORY_SLOT[a.item.category].z - CATEGORY_SLOT[b.item.category].z,
    );

  if (layered.length > 1) {
    const step = (LAYER_SPREAD * 2) / (layered.length - 1);
    layered.forEach((span, index) => {
      span.offsetX = -LAYER_SPREAD + index * step;
    });
  }

  // Walk down the figure pulling each garment up to meet the one above. `reach` is the
  // lowest point covered so far, not the previous garment's hem: a coat spans the top
  // and the bottom, and measuring against it is what keeps shoes under the hem rather
  // than under the jacket.
  let reach = spans[0].top + spans[0].height;
  let shift = 0;

  for (let i = 1; i < spans.length; i += 1) {
    const span = spans[i];
    const adjustedTop = span.top - shift;
    const gap = adjustedTop - reach;
    if (gap > MAX_GAP) shift += gap - MAX_GAP;

    span.top -= shift;
    reach = Math.max(reach, span.top + span.height);
  }

  // Shoes last: they are the only garment anchored from below, so the gap pass above
  // can leave them buried under a hem it just pulled down. Pushing them clear extends
  // the figure past the nominal floor, which the frame maths below picks up.
  const shoes = spans.filter((s) => s.item.category === "SHOE");
  const hems = spans.filter((s) => s.item.category !== "SHOE").map((s) => s.top + s.height);
  if (shoes.length > 0 && hems.length > 0) {
    const lowestHem = Math.max(...hems);
    for (const shoe of shoes) {
      shoe.top = Math.max(shoe.top, lowestHem - MAX_SHOE_OVERLAP);
    }
  }

  const padding = 0.04;
  let top = Math.min(...spans.map((s) => s.top)) - padding;
  let bottom = Math.max(...spans.map((s) => s.top + s.height)) + padding;

  /**
   * Guarantee the frame is tall enough for the largest *box*, not just the largest
   * garment.
   *
   * A box is enlarged by the canvas-fill correction, so it exceeds the garment it
   * holds. Once gap-closing tightens the frame — a shorts outfit collapses a long way —
   * a box can end up taller than the frame, which `overflow-hidden` then crops without
   * any error to notice.
   */
  const tallestBox = Math.max(
    ...spans.map((s) => s.height / CATEGORY_EXTENT[s.item.category].height),
  );
  // A little headroom so rounding can never push a box past the frame edge.
  const deficit = tallestBox * 1.02 - (bottom - top);
  if (deficit > 0) {
    top -= deficit / 2;
    bottom += deficit / 2;
  }

  return { placed: spans, frame: { top, bottom } };
}
