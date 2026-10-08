import { CANVAS_SIZE, CATEGORY_EXTENT } from "@/lib/images/normalize";
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
    // Over the upper layers, not behind them — reversed once tops began spreading side
    // by side.
    //
    // The old reasoning was sound while layers were stacked on the centre line: a belt
    // under an untucked shirt is not visible, so drawing it across the shirt's body
    // looked wrong. But a spread layout is a flat lay, not a photograph of a person —
    // the shirt is laid *beside* the blazer, not over it — so "under the shirt" has
    // stopped meaning anything. What it produced instead was worse than either: the
    // shirt, offset to one side, covered half the belt and left a fragment poking out
    // past its edge, which reads as a rendering fault rather than a garment.
    //
    // 47 clears the layered band (30 to 44) and the tie at 46, and stays under footwear.
    z: 47,
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

  // Shoes stand on the floor, so it is their *bottom* edge that is fixed.
  //
  // Sized by width, not height — the second category to need this, for the same reason
  // as the belt but more starkly. A fixed height of 0.13 left the *width* to fall out of
  // the photograph: measured across 28 pairs it ranged from 0.068 to 0.231, a 3.4x
  // spread, with knee-high boots a third the width of a pair of Converse purely because
  // boots are photographed tall and sneakers are photographed wide.
  //
  // Foot length is the dimension that is actually constant from one pair to the next, and
  // it is what a side-on photograph puts on the horizontal axis. Fixing that makes a
  // knee-high boot tall and a loafer flat, which is the real difference between them.
  //
  // 0.175 is the median width the old height-based rule produced, so the typical pair is
  // unchanged and only the outliers move.
  SHOE: {
    slot: "SHOES",
    label: "Shoes",
    height: 0.13,
    widthTarget: 0.175,
    anchor: FLOOR,
    edge: "bottom",
    z: 50,
  },

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


/**
 * Garments whose whole shape differs from their category's, not just their hem.
 *
 * `LENGTH_OVERRIDES` moves a hem and nothing else, which covers almost everything: a
 * mini skirt is a skirt that stops sooner. Tights are the case it cannot express. They
 * are catalogued as an accessory — correctly, they are not a bottom you would wear on
 * their own — but the accessory layout is built around a belt: anchored at the waist,
 * sized to about a fifth of the figure's width, painted over the waistband. Applied to
 * tights that drew a leg-shaped smudge at hip height, in front of the skirt.
 *
 * So this overrides the parts of the slot that differ, and leaves the rest. Matched
 * most specific first, like the other two tables.
 */
const SHAPE_OVERRIDES: Array<{
  match: RegExp;
  categories: Category[];
  layout: Partial<SlotLayout>;
}> = [
  {
    // Hosiery: hangs from the waist, runs to the ankle, and is worn *under* everything
    // on the lower body. The z is the point — below BOTTOM's 20 and DRESS's 28, so a
    // skirt or dress covers the top of them exactly as it does on a person.
    match: /\b(tights|stockings|pantyhose|hosiery)\b/i,
    categories: ["ACCESSORY"],
    layout: {
      height: 0.5,
      // Width-targeted, and anchored at the floor rather than the waist.
      //
      // Sized by height they drew 0.135 wide against a 0.386 skirt — two legs occupying
      // a third of the width of the garment above them, which is what "the tights look
      // odd" was. A flat-laid pair photographs tall and narrow; a pair of legs is
      // neither. Width is the dimension that is stable on a body.
      //
      // Floor-anchored because the height then follows the photograph's aspect and comes
      // out taller than waist-to-ankle. Hanging them from the waist would push the hem
      // through the floor; standing them on it instead puts the extra length up behind
      // the skirt, where z 18 hides it anyway.
      // 0.16 rather than the 0.20 a leg suggests, because the two constraints fight.
      // The garment fills only about 62% of its canvas height, so its *box* is 1.6x its
      // drawn height — and the frame must be tall enough for the tallest box or it crops.
      // At 0.20 the box reached 1.20 against a figure spanning 0.93, and the frame padded
      // to fit, opening a gap between the hem and the shoes. 0.16 still reads as legs and
      // leaves the composition alone.
      widthTarget: 0.16,
      anchor: FLOOR,
      edge: "bottom",
      z: 18,
    },
  },
  {
    // A tie hangs from the collar to about the waist, and is the one accessory worn
    // *over* the garment it sits on rather than under it — unlike the belt at 22, which
    // an untucked shirt is supposed to hide.
    //
    // 46 rather than a number just above TOP's 30, because the layered categories do
    // not use their static z: `paintDepth` spreads them across a band from
    // LAYER_Z_BASE to LAYER_Z_BASE + LAYER_Z_SPAN, so a shirt actually resolves to
    // 38.75 and a camisole higher still. The tie has to clear the whole band, and stay
    // under footwear at 50.
    //
    // Shoulder-anchored like every upper-body piece, so it lines up with the collar of
    // whatever it is worn with instead of floating at its own height.
    match: /\b(tie|necktie|bow ?tie)\b/i,
    categories: ["ACCESSORY"],
    layout: {
      height: 0.28,
      anchor: SHOULDER,
      edge: "top",
      widthTarget: undefined,
      z: 46,
    },
  },
  {
    // Socks sit at the ankle and are worn under both the shoe and the trouser hem.
    //
    // Anchored at the ankle by their *bottom* edge, like shoes, because that is the end
    // with a fixed position — a crew sock and a knee sock share a heel and differ at
    // the top. Height is sized so the cuff clears the top of a shoe: shoes occupy
    // roughly 0.87–1.0, so ending at 0.95 and starting at 0.82 leaves a band visible
    // between the shoe and the hem, which is the only part of a sock anyone sees.
    match: /\b(socks?|crew socks?|ankle socks?)\b/i,
    categories: ["ACCESSORY"],
    layout: {
      height: 0.13,
      anchor: 0.95,
      edge: "bottom",
      widthTarget: undefined,
      // Behind the shoe (50) and behind the trouser (20): a shoe covers the foot of the
      // sock and a hem covers its cuff, which is exactly the order on a leg.
      z: 19,
    },
  },
];

/**
 * The layout a garment actually uses: its category's, with any shape override applied.
 *
 * Everything that positions or paints a garment goes through here rather than reading
 * `CATEGORY_SLOT` directly, so an override cannot be honoured in one place and missed
 * in another — which is precisely how tights ended up the right size in the builder and
 * the wrong size on the figure.
 */
export function slotFor(subject: LayoutSubject): SlotLayout {
  const base = CATEGORY_SLOT[subject.category];
  const override = SHAPE_OVERRIDES.find(
    (rule) => rule.categories.includes(subject.category) && rule.match.test(describe(subject)),
  );
  return override ? { ...base, ...override.layout } : base;
}

/** The text the override tables match against: subcategory, name, then silhouette. */
const describe = (subject: LayoutSubject) =>
  [subject.subcategory, subject.name, ...(subject.silhouette ?? [])]
    .filter(Boolean)
    .join(" ");

/** Everything about a garment that bears on how long it is. */
export type LayoutSubject = {
  category: Category;
  subcategory?: string | null;
  name?: string | null;
  silhouette?: readonly string[];
  /** Separates a long-sleeve top from a sleeveless one when the name doesn't. */
  sleeveLength?: string | null;
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
  const base = slotFor(subject);
  const text = describe(subject);

  const override = LENGTH_OVERRIDES.find(
    (rule) => rule.categories.includes(subject.category) && rule.match.test(text),
  );

  const height = override?.height ?? base.height;
  const top = base.edge === "top" ? base.anchor : base.anchor - height;

  return { height, top };
}

/**
 * Paint order, back to front.
 *
 * Shoulder-hung garments are ordered among themselves by how far out they are worn,
 * so paint order and left-to-right order come from the same number and cannot
 * disagree: the outermost garment is leftmost *and* furthest back, which is the
 * flat-lay convention the rest of this follows.
 *
 * Their band sits between the waistband and the shoes, so every upper layer still
 * paints over trousers and under footwear however they are ordered internally.
 */
const LAYER_Z_BASE = 30;
const LAYER_Z_SPAN = 14;

export function paintDepth(subject: LayoutSubject): number {
  if (!LAYERED_CATEGORIES.includes(subject.category)) {
    return slotFor(subject).z;
  }
  // Ranks run 10–80; map them into the band without letting rounding collapse two.
  return LAYER_Z_BASE + (outerness(subject) / 80) * LAYER_Z_SPAN;
}

export function byPaintOrder<T extends LayoutSubject>(items: readonly T[]): T[] {
  return [...items].sort((a, b) => paintDepth(a) - paintDepth(b));
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

/**
 * How wide a shoulder-hung garment should draw, absent any other evidence.
 *
 * Matching layers against each other says nothing about how big the group should be, and
 * says nothing at all when there is only one of them — which is the common case, and the
 * one that looked wrong. A lone top took whatever width its photograph implied: measured
 * across 80 tops that ran from 0.147 to 0.418 of the figure, a 2.8x spread between
 * garments whose real chest widths are within a few centimetres of each other.
 *
 * 0.24 is the median of those measured widths, so the typical top does not move and the
 * outliers are pulled toward it — and only as far as SHOULDER_MATCH_LIMIT allows, since a
 * genuinely oversized coat should still read as oversized.
 */
const CANONICAL_SHOULDER_WIDTH = 0.24;

/**
 * How wide a bottom should draw across the hip.
 *
 * Same problem as the shoulders and the same fix, found by measuring: across 26 bottoms
 * the drawn width ran 0.155 to 0.386, and the widest garment in the closet was a flowy
 * mini skirt — wider than wide-leg jeans and wider than straight-leg jeans. Three mini
 * skirts alone ranged 0.213 to 0.386. None of that is a fact about the clothes; a short
 * flared skirt photographs wide and a legging photographs narrow, and the height-based
 * rule turns that straight into drawn width.
 *
 * 0.27 is the median of those measurements, so the typical bottom barely moves.
 *
 * Unlike shoes this cannot be a plain `widthTarget`, because that back-computes height
 * from the photograph and would overrule the length rules — a mini and a maxi would stop
 * differing. Scaling toward the target keeps the length ordering while fixing the width,
 * at the cost of a little length accuracy, which is the right way round: the complaint
 * was that a waist did not match the hem of the top above it, never that a skirt was the
 * wrong length.
 */
const CANONICAL_HIP_WIDTH = 0.27;

/**
 * The space a shoulder-hung garment should occupy, as a fraction of the figure squared.
 *
 * The canonical width times a typical top's length. It anchors the group's absolute size
 * the way CANONICAL_SHOULDER_WIDTH used to, now that the matching works on area.
 */
const CANONICAL_TORSO_AREA = CANONICAL_SHOULDER_WIDTH * 0.31;

/**
 * Pull a bottom toward the canonical hip width.
 *
 * There is only ever one bottom, so unlike the shoulders there is nothing to reconcile
 * it against — the target is the canonical width outright, limited by the same factor so
 * a genuinely voluminous skirt still reads as voluminous.
 */
function matchWaist<T extends LayoutSubject>(
  spans: Array<{ item: T; top: number; height: number }>,
): void {
  for (const span of spans) {
    if (span.item.category !== "BOTTOM") continue;

    const width = drawnWidth(span.item, span.height);
    if (!width) continue;

    span.height *= Math.min(
      SHOULDER_MATCH_LIMIT.max,
      Math.max(SHOULDER_MATCH_LIMIT.min, CANONICAL_HIP_WIDTH / width),
    );
  }
}

/** The width this garment will actually be drawn at, given the height it is laid out to. */
export function drawnWidth(subject: LayoutSubject, height: number): number | null {
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
  if (layers.length === 0) return;

  /**
   * Matched on *area*, not width.
   *
   * Width was the obvious objective and it is the wrong one. Aspect is fixed, so the
   * only way to change a garment's width is to scale its height — and a blazer is
   * photographed wide and short while a camisole hangs narrow and tall. Equalising their
   * widths therefore scaled the blazer down by 40% and the camisole up, until the blazer
   * was shorter than the top worn underneath it. Correct by the stated rule, absurd on
   * the figure.
   *
   * Area is the better proxy for "these should look the same size", which is the thing
   * actually being judged. It still cannot make a wide-short blazer as long as a
   * narrow-tall camisole — nothing aspect-preserving can — but it stops either one
   * looking like a different scale of garment.
   */
  const measured = layers.map((span) => {
    const width = drawnWidth(span.item, span.height);
    return width ? width * span.height : null;
  });
  if (measured.some((area) => !area)) return;
  const areas = measured as number[];

  // The *geometric* mean, so no garment is treated as the authority — none is more
  // correctly photographed than the others, they are just different shapes. It has to
  // be geometric: an arithmetic mean sits nearer the larger widths, so correcting a 3×
  // mismatch would shrink the wide garment by a third while asking the narrow one to
  // nearly double. This splits the ratio evenly, each moving by the same factor.
  // The canonical width joins the mean as one more voice rather than overruling it. With
  // a single layer that makes this "move toward the canonical width, within the limit",
  // which is the case that previously did nothing at all. With several it keeps them
  // agreeing with each other while stopping the whole group drifting to whatever size
  // this particular set of photographs implies.
  const voices = [...areas, CANONICAL_TORSO_AREA];
  const target = Math.exp(
    voices.reduce((sum, area) => sum + Math.log(area), 0) / voices.length,
  );

  layers.forEach((span, index) => {
    // Square root because area goes as the square of the scale: halving a garment's
    // height quarters the space it occupies.
    const scale = Math.min(
      SHOULDER_MATCH_LIMIT.max,
      Math.max(SHOULDER_MATCH_LIMIT.min, Math.sqrt(target / areas[index])),
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

/**
 * Accessories that belong to the innermost layer rather than to the figure's centre.
 *
 * Only a tie so far. A belt sits at the waist where the layers have already converged,
 * and a scarf would arguably want the outermost layer instead — so this is a list, not
 * a flag on the shape override.
 */
const WORN_OVER_INNERMOST = /\b(tie|necktie|bow ?tie)\b/i;

/** Accessories that fasten round a waistband and should match its width. */
const BELTED = /\bbelts?\b/i;

/**
 * A waistband's width as a fraction of the bottom's widest point.
 *
 * Measured off the renders: a straight trouser is nearly 1, an A-line mini skirt about
 * 0.58. 0.62 sits near the flared end on purpose — a belt slightly too narrow reads as
 * a belt, and one too wide reads as a fault.
 */
const BELT_WAIST_RATIO = 0.62;

/**
 * How far out a garment is worn, low to high: a coat is the outermost thing on a
 * person, a dress the innermost.
 *
 * Categories are too coarse for this. Two TOPs — a sweater and a t-shirt — are the
 * same category and are not interchangeable in a layered look, so ordering by category
 * left them in whatever order they happened to be picked in.
 *
 * Matched against subcategory, name and silhouette like the length overrides, most
 * specific first. Blouses and shirts sit between knitwear and plain jersey: a blouse
 * goes *under* a sweater and *over* a tee, which is also where a person would put it.
 */
const OUTERNESS: Array<{ match: RegExp; rank: number }> = [
  { match: /\b(coat|puffer|parka|trench)\b/i, rank: 10 },
  { match: /\b(blazer|jacket|bomber)\b/i, rank: 20 },
  { match: /\b(vest|waistcoat|overshirt|shacket)\b/i, rank: 25 },
  { match: /\bcardigan\b/i, rank: 30 },
  { match: /\b(sweater|knitwear|jumper|hoodie|sweatshirt|fleece|knit)\b/i, rank: 40 },
  // Before the shirt rule: a hyphen is a word boundary, so `\bshirt\b` matches inside
  // "t-shirt" and every tee was being ranked as a shirt.
  { match: /\b(t-shirt|tee)\b/i, rank: 60 },
  { match: /\b(shirt|blouse)\b/i, rank: 50 },
  { match: /\b(bodysuit|turtleneck)\b/i, rank: 55 },
  { match: /\b(tank|camisole|halter|crop top)\b/i, rank: 70 },
];

/** Fallbacks when nothing matches: the category's own place in the order. */
const CATEGORY_OUTERNESS: Partial<Record<Category, number>> = {
  OUTERWEAR: 20,
  TOP: 55,
  // A dress is the base everything else goes over, so it is the innermost thing here.
  DRESS: 80,
};

export function outerness(subject: LayoutSubject): number {
  const text = [subject.subcategory, subject.name, ...(subject.silhouette ?? [])]
    .filter(Boolean)
    .join(" ");

  const matched = OUTERNESS.find((rule) => rule.match.test(text));
  if (matched) return matched.rank;

  // Sleeves separate a long-sleeve top from a sleeveless one when nothing else does.
  if (subject.category === "TOP" && subject.sleeveLength) {
    const sleeves = subject.sleeveLength.toLowerCase();
    if (sleeves === "long" || sleeves === "three-quarter") return 55;
    if (sleeves === "sleeveless") return 70;
    return 60;
  }

  return CATEGORY_OUTERNESS[subject.category] ?? 55;
}

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
    const slot = slotFor(span.item);
    const { renderWidth, renderHeight } = span.item;
    if (!slot.widthTarget || !renderWidth || !renderHeight) continue;

    span.height = slot.widthTarget * (renderHeight / renderWidth);

    // The anchor has to be reapplied, not just the height. A bottom-anchored garment
    // keeps its *lower* edge on the landmark — shoes stand on the floor — so growing a
    // knee-high boot from 0.13 to 0.33 without this leaves its top edge fixed and lifts
    // the sole two thirds of a leg off the ground.
    if (slot.edge === "bottom") span.top = slot.anchor - span.height;
  }

  /**
   * A belt is as wide as the waist it is worn on, so it takes its width from the bottom.
   *
   * The fixed 0.18 it used to draw at was a guess made with no bottom in view, and it
   * showed: against a mini skirt drawing 0.386 the belt came out less than half the
   * width of the waistband it was supposed to be fastening, which reads as a belt
   * floating in front of a skirt rather than one worn with it.
   *
   * BELT_WAIST_RATIO is an approximation and knowingly so. What a belt should match is
   * the bottom's width *at its top edge*, and the only number available here is the
   * bounding box — the widest point, which on an A-line skirt is the hem. Measuring the
   * top edge during processing and storing it is the real fix; this is within a few
   * percent for a straight trouser and errs narrow on a flared skirt, which is the safer
   * direction to be wrong in.
   */
  const lowerGarment = spans.find((span) => span.item.category === "BOTTOM");
  if (lowerGarment) {
    const bottomWidth = drawnWidth(lowerGarment.item, lowerGarment.height);
    for (const span of spans) {
      if (!BELTED.test(describe(span.item))) continue;
      const aspect = span.item.renderWidth && span.item.renderHeight
        ? span.item.renderWidth / span.item.renderHeight
        : null;
      if (!bottomWidth || !aspect) continue;
      span.height = (bottomWidth * BELT_WAIST_RATIO) / aspect;
    }
  }

  // Before anything measures these heights: gap-closing, the frame, and the box-fit
  // clamp all read them, so resizing afterwards would crop the garment it just grew.
  matchShoulders(spans);
  matchWaist(spans);

  // Spread the shoulder-hung layers apart, but only when there is more than one — a
  // lone top belongs on the centre line. Laid out back to front, left to right, so the
  // piece in front sits rightmost the way a flat lay is arranged. Three layers (a
  // cardigan, a dress and a top over it) put the middle one on the centre line.
  // Every shoulder-hung garment, outermost first: a coat, then a cardigan, then a
  // sweater, then a shirt, then a tee. Sorting by *category* put two tops in whatever
  // order they were picked, which is no order at all.
  const layered = spans
    .filter((span) => LAYERED_CATEGORIES.includes(span.item.category))
    .sort((a, b) => outerness(a.item) - outerness(b.item));

  if (layered.length > 1) {
    const step = (LAYER_SPREAD * 2) / (layered.length - 1);
    layered.forEach((span, index) => {
      span.offsetX = -LAYER_SPREAD + index * step;
    });
  }

  /**
   * A tie rides on the innermost layer rather than on the centre line.
   *
   * It is worn over a shirt, and the shirt is the *last* of the layered pieces — the
   * spread above puts the outermost garment leftmost and the innermost rightmost, so a
   * centred tie lands in the gap between a cardigan and the shirt it belongs to,
   * touching neither. Taking the innermost garment's offset puts it on the collar it
   * would actually hang from.
   *
   * No spread, one layer, nothing to follow: the tie stays centred, which is where the
   * lone shirt is too.
   */
  const innermost = layered.at(-1);
  if (innermost) {
    for (const span of spans) {
      if (WORN_OVER_INNERMOST.test(describe(span.item))) {
        span.offsetX = innermost.offsetX;
      }
    }
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
    ...spans.map((s) => {
      // The *measured* fill where there is one, exactly as the renderer does. Using the
      // category fallback for a measured item overstates its box, and for a garment
      // whose real fill is far from its category's that overstates it wildly: tights
      // sized to a leg came out with a box twice the frame, which padded the whole
      // figure and left a gap between the hem and the shoes.
      const fill = s.item.renderHeight
        ? s.item.renderHeight / CANVAS_SIZE
        : CATEGORY_EXTENT[s.item.category].height;
      return s.height / fill;
    }),
  );
  // A little headroom so rounding can never push a box past the frame edge.
  const deficit = tallestBox * 1.02 - (bottom - top);
  if (deficit > 0) {
    top -= deficit / 2;
    bottom += deficit / 2;
  }

  return { placed: spans, frame: { top, bottom } };
}
