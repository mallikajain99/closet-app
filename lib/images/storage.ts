import "server-only";

import { ORIGINALS_BUCKET, PROCESSED_BUCKET } from "@/lib/images/storage.client";
import { createAdminClient } from "@/lib/supabase/admin";

export { ORIGINALS_BUCKET, PROCESSED_BUCKET };

/** Signed read URLs are short-lived; pages re-mint them on each render. */
const READ_URL_TTL_SECONDS = 60 * 60;

/**
 * Storage key for an item's source image.
 *
 * Namespaced by user so a future shared-closet mode needs no data migration, and so a
 * leaked key can't be walked to another user's images.
 */
export function buildOriginalKey(userId: string, fileName: string) {
  const extension = fileName.split(".").pop()?.toLowerCase() ?? "jpg";
  return `${userId}/${crypto.randomUUID()}.${extension}`;
}

/**
 * Mint a one-time upload URL the browser can PUT directly to.
 *
 * Phone photos routinely exceed Vercel's 4.5 MB request body limit, so files must not be
 * routed through a Server Action. The client uploads straight to Supabase Storage and
 * only the resulting key comes back through our server.
 */
export async function createSignedUpload(userId: string, fileName: string) {
  const supabase = createAdminClient();
  const key = buildOriginalKey(userId, fileName);

  const { data, error } = await supabase.storage
    .from(ORIGINALS_BUCKET)
    .createSignedUploadUrl(key);

  if (error || !data) {
    throw new Error(`Could not create upload URL: ${error?.message ?? "unknown error"}`);
  }

  return { key, signedUrl: data.signedUrl, token: data.token };
}

/** A time-limited URL for displaying a private image. Null when the key is missing. */
export async function getSignedImageUrl(
  key: string | null | undefined,
  bucket: string = ORIGINALS_BUCKET,
) {
  if (!key) return null;

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrl(key, READ_URL_TTL_SECONDS);

  return error ? null : (data?.signedUrl ?? null);
}

/** Batch variant — one round trip instead of one per item, which matters for the grid. */
export async function getSignedImageUrls(
  keys: readonly (string | null | undefined)[],
  bucket: string = ORIGINALS_BUCKET,
): Promise<Map<string, string>> {
  const present = keys.filter((key): key is string => Boolean(key));
  if (present.length === 0) return new Map();

  const supabase = createAdminClient();
  const { data, error } = await supabase.storage
    .from(bucket)
    .createSignedUrls(present, READ_URL_TTL_SECONDS);

  if (error || !data) return new Map();

  const entries: [string, string][] = [];
  for (const entry of data) {
    if (entry.path && entry.signedUrl) entries.push([entry.path, entry.signedUrl]);
  }
  return new Map(entries);
}

/**
 * The image an item should actually be shown with.
 *
 * Originals and renders live in *different buckets*, so a key alone is not enough to
 * sign — signing a processed key against the originals bucket returns "Object not
 * found", which silently renders as "No photo". Callers must go through this rather
 * than picking a key and signing it themselves.
 *
 * Falls back to the source photo whenever there's no render yet: pending, failed, and
 * user-overridden items all stay visible.
 */
export type ItemImageRefs = {
  id: string;
  originalImageKey: string | null;
  processedImageKey: string | null;
  thumbnailKey?: string | null;
};

export async function getItemImageUrls(
  items: readonly ItemImageRefs[],
  prefer: "full" | "thumbnail" = "full",
): Promise<Map<string, string>> {
  const renderKeyFor = (item: ItemImageRefs) =>
    (prefer === "thumbnail" ? item.thumbnailKey : null) ?? item.processedImageKey;

  // Two batched calls — one per bucket — rather than one per item, which would dominate
  // the render of a grid at a few hundred items.
  const [renders, originals] = await Promise.all([
    getSignedImageUrls(items.map(renderKeyFor), PROCESSED_BUCKET),
    // Every original is signed, not just the ones missing a render, so that a render
    // whose object has gone missing still falls back to a visible photo.
    getSignedImageUrls(items.map((item) => item.originalImageKey), ORIGINALS_BUCKET),
  ]);

  const resolved = new Map<string, string>();
  for (const item of items) {
    const renderKey = renderKeyFor(item);
    const url =
      (renderKey ? renders.get(renderKey) : null) ??
      (item.originalImageKey ? originals.get(item.originalImageKey) : null);
    if (url) resolved.set(item.id, url);
  }
  return resolved;
}

/** Single-item variant, for the detail page. */
export async function getItemImageUrl(item: ItemImageRefs) {
  return (await getItemImageUrls([item])).get(item.id) ?? null;
}

/** Best-effort cleanup. A failure here must not block deleting the item itself. */
export async function deleteImage(key: string | null | undefined, bucket: string = ORIGINALS_BUCKET) {
  if (!key) return;
  const supabase = createAdminClient();
  await supabase.storage.from(bucket).remove([key]);
}
