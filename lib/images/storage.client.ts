/**
 * Storage constants shared by client and server.
 *
 * Kept separate from `storage.ts`, which is marked `server-only` because it holds the
 * service-role client. The browser needs the bucket name and upload limits to drive the
 * direct-to-storage upload, but must never reach the admin credentials.
 */

export const ORIGINALS_BUCKET = "closet-originals";
export const PROCESSED_BUCKET = "closet-processed";

export const MAX_UPLOAD_BYTES = 15 * 1024 * 1024;

export const ACCEPTED_IMAGE_TYPES = [
  "image/jpeg",
  "image/png",
  "image/webp",
  "image/heic",
  "image/heif",
] as const;
