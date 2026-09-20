import { describe, expect, it } from "vitest";

import { MAX_CORRECTION_DEGREES, estimateTilt } from "@/lib/images/straighten";

const SIZE = 200;

/**
 * A filled rectangle of `w`×`h`, rotated clockwise by `degrees` about the centre.
 *
 * Built by inverse-mapping each pixel, so the shape stays solid at any angle rather
 * than developing the gaps a forward rotation would leave.
 */
function rectangle(w: number, h: number, degrees: number): Uint8Array {
  const alpha = new Uint8Array(SIZE * SIZE);
  const radians = (degrees * Math.PI) / 180;
  const cos = Math.cos(-radians);
  const sin = Math.sin(-radians);
  const c = SIZE / 2;

  for (let y = 0; y < SIZE; y += 1) {
    for (let x = 0; x < SIZE; x += 1) {
      const dx = x - c;
      const dy = y - c;
      const rx = dx * cos - dy * sin;
      const ry = dx * sin + dy * cos;
      if (Math.abs(rx) <= w / 2 && Math.abs(ry) <= h / 2) alpha[y * SIZE + x] = 255;
    }
  }
  return alpha;
}

describe("estimateTilt", () => {
  it("reports no lean for an upright garment shape", () => {
    const { degrees } = estimateTilt(rectangle(40, 140, 0), SIZE, SIZE);
    expect(Math.abs(degrees)).toBeLessThan(0.5);
  });

  it("measures a clockwise lean", () => {
    const { degrees, correctable } = estimateTilt(rectangle(40, 140, 6), SIZE, SIZE);
    expect(correctable).toBe(true);
    expect(degrees).toBeCloseTo(6, 0);
  });

  it("measures an anticlockwise lean with the opposite sign", () => {
    const { degrees } = estimateTilt(rectangle(40, 140, -8), SIZE, SIZE);
    expect(degrees).toBeCloseTo(-8, 0);
  });

  it("measures a wide garment against horizontal, not vertical", () => {
    // A shirt with sleeves out is genuinely wider than tall. Measuring its major axis
    // against vertical would call it 90° crooked and rotate it onto its side.
    const { degrees, correctable } = estimateTilt(rectangle(150, 60, 5), SIZE, SIZE);
    expect(correctable).toBe(true);
    expect(degrees).toBeCloseTo(5, 0);
  });

  it("declines to correct a shape with no meaningful axis", () => {
    // A square — or a folded jumper, or shoes seen from above — has no major axis, and
    // any angle computed from it is noise that would tilt a straight garment.
    expect(estimateTilt(rectangle(120, 120, 0), SIZE, SIZE).correctable).toBe(false);
  });

  it("declines to correct a lean beyond the cap", () => {
    // Past this the shape is probably genuinely diagonal, and rotating it would be a
    // bigger error than leaving it.
    const { correctable } = estimateTilt(
      rectangle(40, 140, MAX_CORRECTION_DEGREES + 8),
      SIZE,
      SIZE,
    );
    expect(correctable).toBe(false);
  });

  it("declines on an empty or near-empty mask", () => {
    expect(estimateTilt(new Uint8Array(SIZE * SIZE), SIZE, SIZE).correctable).toBe(false);
  });
});
