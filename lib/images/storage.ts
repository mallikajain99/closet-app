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

/** Best-effort cleanup. A failure here must not block deleting the item itself. */
export async function deleteImage(key: string | null | undefined, bucket: string = ORIGINALS_BUCKET) {
  if (!key) return;
  const supabase = createAdminClient();
  await supabase.storage.from(bucket).remove([key]);
}
