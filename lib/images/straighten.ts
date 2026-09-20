/**
 * Straighten a garment that was photographed hanging crooked.
 *
 * Hangers sit at a slight angle far more often than not, and once a whole outfit is
 * composited the tilts don't agree with each other — a shirt leaning one way over jeans
 * leaning the other reads as broken rather than as casual.
 *
 * The angle comes from second-order image moments of the cutout's alpha: the classic
 * deskew. It needs no model and no network, so straightening existing renders costs
 * nothing.
 */

/** Beyond this, a shape is assumed to be genuinely diagonal rather than crooked. */
export const MAX_CORRECTION_DEGREES = 12;

/**
 * How elongated a shape must be before its orientation means anything.
 *
 * A roughly circular mask — a folded jumper, a pair of shoes seen from above — has no
 * meaningful major axis, and the computed angle is then noise that would rotate a
 * perfectly straight garment. Measured as the relative difference between the two
 * spreads.
 */
const MIN_ELONGATION = 0.08;

export type TiltEstimate = {
  /** Degrees clockwise the garment is leaning. Positive means it needs rotating back. */
  degrees: number;
  /** False when the shape was too round, too empty, or too crooked to trust. */
  correctable: boolean;
};

/**
 * Estimate how far a masked shape leans, in degrees.
 *
 * Works in image coordinates, where y grows downward, so a positive result already
 * means "leaning clockwise on screen". Straightening means rotating by -degrees.
 */
export function estimateTilt(
  alpha: Uint8Array,
  width: number,
  height: number,
): TiltEstimate {
  let count = 0;
  let sumX = 0;
  let sumY = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < 128) continue;
      count += 1;
      sumX += x;
      sumY += y;
    }
  }

  if (count < 64) return { degrees: 0, correctable: false };

  const cx = sumX / count;
  const cy = sumY / count;

  let m20 = 0;
  let m02 = 0;
  let m11 = 0;

  for (let y = 0; y < height; y += 1) {
    for (let x = 0; x < width; x += 1) {
      if (alpha[y * width + x] < 128) continue;
      const dx = x - cx;
      const dy = y - cy;
      m20 += dx * dx;
      m02 += dy * dy;
      m11 += dx * dy;
    }
  }

  m20 /= count;
  m02 /= count;
  m11 /= count;

  const spread = m20 + m02;
  if (spread === 0) return { degrees: 0, correctable: false };

  const elongation = Math.hypot(m20 - m02, 2 * m11) / spread;
  if (elongation < MIN_ELONGATION) return { degrees: 0, correctable: false };

  // Orientation of the major axis, measured from the x-axis.
  const theta = 0.5 * Math.atan2(2 * m11, m20 - m02);

  // A garment hangs vertically, so the major axis is normally near ±90°. But a shirt
  // with sleeves spread is genuinely wider than tall, and its major axis is horizontal —
  // measuring that against vertical would rotate it 90°. Compare against whichever axis
  // the shape is actually aligned to.
  const majorIsVertical = m02 > m20;
  const fromAxis = majorIsVertical ? theta - Math.PI / 2 : theta;

  // Fold into (-90°, 90°], then to the nearest of 0 — a lean is small by definition.
  let radians = fromAxis;
  while (radians > Math.PI / 2) radians -= Math.PI;
  while (radians <= -Math.PI / 2) radians += Math.PI;

  const degrees = (radians * 180) / Math.PI;

  return {
    degrees,
    correctable: Math.abs(degrees) <= MAX_CORRECTION_DEGREES,
  };
}

/**
 * Rotate a cut-out garment upright, if it is leaning and the lean is trustworthy.
 *
 * Returns the original buffer untouched when there's nothing to correct, so callers can
 * use it unconditionally. Rotation is done on a transparent background and the result
 * is re-trimmed by the caller, which absorbs the extra canvas rotation introduces.
 */
export async function straighten(cutout: Buffer): Promise<{ buffer: Buffer; degrees: number }> {
  const sharp = (await import("sharp")).default;

  const { data, info } = await sharp(cutout)
    .ensureAlpha()
    .extractChannel(3)
    .raw()
    .toBuffer({ resolveWithObject: true });

  const alpha = new Uint8Array(info.width * info.height);
  for (let i = 0; i < alpha.length; i += 1) alpha[i] = data[i * info.channels];

  const { degrees, correctable } = estimateTilt(alpha, info.width, info.height);

  // Below half a degree the rotation costs a resample and buys nothing visible.
  if (!correctable || Math.abs(degrees) < 0.5) return { buffer: cutout, degrees: 0 };

  const buffer = await sharp(cutout)
    .rotate(-degrees, { background: { r: 0, g: 0, b: 0, alpha: 0 } })
    .png()
    .toBuffer();

  return { buffer, degrees };
}
