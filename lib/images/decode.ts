import sharp from "sharp";

/**
 * Make a source image readable by `sharp`, converting HEIC when it isn't.
 *
 * Phones shoot HEIC by default, and the app uploads whatever the camera produced
 * straight to storage. sharp's bundled libheif decodes some HEIC files and not others —
 * a modern iPhone's 10-bit HDR variant fails with "Decoder plugin generated an error",
 * which left an item with no render at all. Chrome cannot display raw HEIC either, so
 * the usual fallback of showing the original photo also produced a blank.
 *
 * The bulk import script never hit this because it shells out to `sips` first. That is
 * a macOS binary and doesn't exist on Vercel, so the fix has to be in the pipeline: a
 * pure-JS decoder, tried only when sharp has already failed, so the common path stays
 * on the fast native one.
 */
export async function toDecodable(source: Buffer): Promise<Buffer> {
  try {
    // Decode a thumbnail rather than read metadata. `metadata()` only parses the
    // container header, which succeeds on exactly the HEIC files whose *pixels* sharp
    // then fails to decode — so probing with it never triggers this fallback.
    await sharp(source).resize(8, 8, { fit: "fill" }).raw().toBuffer();
    return source;
  } catch {
    // Not decodable — fall through to the HEIC decoder below.
  }

  const { default: heicConvert } = await import("heic-convert");
  const output = await heicConvert({
    buffer: new Uint8Array(source),
    format: "JPEG",
    quality: 0.92,
  });

  const converted = Buffer.from(output);

  // If this still isn't decodable the source is genuinely broken, and the caller should
  // see that rather than a confusing failure three steps later.
  await sharp(converted).resize(8, 8, { fit: "fill" }).raw().toBuffer();
  return converted;
}
