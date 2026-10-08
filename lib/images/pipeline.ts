/**
 * The image pipeline for a single item: download the original, cut the garment out of
 * its background, normalize it onto the shared canvas, and store both a full-size and a
 * thumbnail render.
 *
 * This module is the one implementation. `scripts/process-images.ts` loops over it for
 * backfills, and the catalog Server Actions schedule it with `after()` when an item
 * gains a photo. Deliberately free of `server-only` and of any top-level environment
 * read, so a plain `tsx` script can import it the same way a request can.
 *
 * Originals are never modified. A failure leaves the item showing its source photo.
 */

import { type Category, type PrismaClient } from "@prisma/client";
import sharp from "sharp";

import { db } from "@/lib/db";
import { toDecodable } from "@/lib/images/decode";
import { ORIGINALS_BUCKET, PROCESSED_BUCKET } from "@/lib/images/storage.client";
import {
  CANVAS_SIZE,
  THUMBNAIL_SIZE,
  fitToCategory,
  placeOnCanvas,
  type Size,
} from "@/lib/images/normalize";
import { createAdminClient } from "@/lib/supabase/admin";

export type ProcessOutcome =
  | { ok: true; fullKey: string; thumbKey: string; trimmedSize: Size; fitted: Size }
  | { ok: false; error: string };

/**
 * Place a cut-out garment on the shared canvas.
 *
 * Trim first: the segmenter returns a full-frame image that is mostly transparent, so
 * without trimming to the garment's true bounds every item would be scaled by how much
 * empty space happened to surround it rather than by its own size.
 */
export async function normalizeCutout(cutout: Buffer, category: Category) {
  const trimmed = await sharp(cutout).trim({ threshold: 10 }).png().toBuffer();
  const meta = await sharp(trimmed).metadata();

  if (!meta.width || !meta.height) throw new Error("Could not read trimmed dimensions.");

  const fitted = fitToCategory({ width: meta.width, height: meta.height }, category);
  const { left, top } = placeOnCanvas(fitted, category);

  const resized = await sharp(trimmed)
    .resize(fitted.width, fitted.height, { fit: "fill" })
    .png()
    .toBuffer();

  // Composite once to a buffer, then derive both outputs from it. Calling .clone() on a
  // `create`-based pipeline loses the canvas dimensions, and the composite then fails
  // with "Image to composite must have same dimensions or smaller" even though the
  // garment is comfortably smaller than the canvas.
  const composited = await sharp({
    create: {
      width: CANVAS_SIZE,
      height: CANVAS_SIZE,
      channels: 4,
      background: { r: 0, g: 0, b: 0, alpha: 0 },
    },
  })
    .composite([{ input: resized, left, top }])
    .png()
    .toBuffer();

  const full = await sharp(composited).webp({ quality: 90, alphaQuality: 100 }).toBuffer();
  const thumb = await sharp(composited)
    .resize(THUMBNAIL_SIZE, THUMBNAIL_SIZE)
    .webp({ quality: 82, alphaQuality: 100 })
    .toBuffer();

  return { full, thumb, trimmedSize: { width: meta.width, height: meta.height }, fitted };
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Node's fetch reports transport problems as a bare "fetch failed" and puts the real
 * reason on `cause`. Without unwrapping it, a connection reset, a DNS failure and a
 * timeout are indistinguishable in the logs.
 */
export function describeError(error: unknown) {
  const message = error instanceof Error ? error.message : String(error);
  const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
  if (!cause) return message;

  const code = "code" in cause ? ` [${String(cause.code)}]` : "";
  return `${message} (${cause.name}: ${cause.message}${code})`;
}

/**
 * Retry the whole segment-and-normalize step for one item.
 *
 * Over a long run, Node's shared fetch agent starts failing with a bare "fetch failed" —
 * a degraded connection rather than a rejection. A fresh process always worked, and the
 * same operation succeeds moments later, so the item is worth retrying rather than
 * marking failed.
 */
async function withRetry<T>(
  operation: (attempt: number) => Promise<T>,
  attempts: number,
  onRetry?: (delayMs: number) => void,
): Promise<T> {
  let lastError: unknown;

  for (let attempt = 1; attempt <= attempts; attempt += 1) {
    try {
      return await operation(attempt);
    } catch (error) {
      lastError = error;
      const cause = error instanceof Error ? (error.cause as Error | undefined) : undefined;
      const text = `${error instanceof Error ? error.message : ""} ${cause?.message ?? ""}`;
      const transient = /fetch failed|socket|ECONN|ETIMEDOUT|HTTP2|session/i.test(text);
      if (!transient || attempt === attempts) throw error;

      const delay = 2000 * attempt;
      onRetry?.(delay);
      await sleep(delay);
    }
  }

  throw lastError;
}

/** Storage keys are derived from the item id, so a re-run overwrites rather than orphans. */
export const processedKeysFor = (itemId: string) => ({
  fullKey: `${itemId}.webp`,
  thumbKey: `${itemId}-thumb.webp`,
});

type ItemToProcess = {
  id: string;
  category: Category;
  /** Guides the body mask: what to protect when the photo is of someone wearing it. */
  subcategory: string | null;
  originalImageKey: string;
};

/** Record progress on the item's `ImageJob` row so a failure can be explained in the UI. */
async function recordJob(
  client: PrismaClient,
  itemId: string,
  data: { status: "PROCESSING" | "DONE" | "FAILED"; step?: string | null; error?: string | null },
) {
  const existing = await client.imageJob.findFirst({
    where: { subjectType: "ITEM", subjectId: itemId },
    orderBy: { createdAt: "desc" },
    select: { id: true, attempts: true },
  });

  const completedAt = data.status === "PROCESSING" ? null : new Date();

  if (!existing) {
    await client.imageJob.create({
      data: { subjectType: "ITEM", subjectId: itemId, attempts: 1, completedAt, ...data },
    });
    return;
  }

  await client.imageJob.update({
    where: { id: existing.id },
    data: {
      ...data,
      completedAt,
      ...(data.status === "PROCESSING" ? { attempts: existing.attempts + 1 } : {}),
    },
  });
}

/**
 * Run the pipeline for one item and persist the result.
 *
 * Never throws: a failure is recorded on the item and its job row, because the caller is
 * usually a fire-and-forget `after()` callback or a batch loop that must keep going.
 */
export async function processItemImage(
  itemId: string,
  options: { client?: PrismaClient; onRetry?: (delayMs: number) => void } = {},
): Promise<ProcessOutcome> {
  const client = options.client ?? (db as PrismaClient);

  const item = await client.item.findUnique({
    where: { id: itemId },
    select: { id: true, category: true, subcategory: true, originalImageKey: true },
  });

  if (!item?.originalImageKey) return { ok: false, error: "Item has no source image." };

  return runPipeline(client, item as ItemToProcess, options.onRetry);
}

/** Shared by the single-item entry point and the batch script, which has already loaded rows. */
export async function runPipeline(
  client: PrismaClient,
  item: ItemToProcess,
  onRetry?: (delayMs: number) => void,
): Promise<ProcessOutcome> {
  // Imported lazily so that callers which never process anything — a dry run, a page
  // that only reads status — don't require REPLICATE_API_TOKEN to be present.
  const { cutOutGarment } = await import("@/lib/images/segment");

  await client.item.update({
    where: { id: item.id },
    data: { processingStatus: "PROCESSING" },
  });
  await recordJob(client, item.id, { status: "PROCESSING", step: "segment", error: null });

  try {
    const { full, thumb, trimmedSize, fitted } = await withRetry(
      async () => {
        // A fresh client every attempt. The Supabase client holds an HTTP/2 session that
        // can be destroyed mid-run (ERR_HTTP2_INVALID_SESSION); once that happens every
        // subsequent call on it fails, so retrying the same client just burns attempts.
        const storage = createAdminClient();

        const { data, error } = await storage.storage
          .from(ORIGINALS_BUCKET)
          .download(item.originalImageKey);
        if (error || !data) throw new Error(`download failed: ${error?.message ?? "no data"}`);

        // Phones upload HEIC, which sharp cannot always decode — convert first.
        const original = await toDecodable(Buffer.from(await data.arrayBuffer()));
        // Category and subcategory go in so the segmenter knows what to protect when
        // the photograph turns out to be of someone wearing the garment.
        const cutout = await cutOutGarment(original, {
          category: item.category,
          subcategory: item.subcategory,
        });
        return normalizeCutout(cutout, item.category);
      },
      3,
      onRetry,
    );

    const { fullKey, thumbKey } = processedKeysFor(item.id);
    const storage = createAdminClient();

    for (const [key, buffer] of [
      [fullKey, full],
      [thumbKey, thumb],
    ] as const) {
      const up = await storage.storage.from(PROCESSED_BUCKET).upload(key, buffer, {
        contentType: "image/webp",
        upsert: true,
      });
      if (up.error) throw new Error(`upload failed: ${up.error.message}`);
    }

    await client.item.update({
      where: { id: item.id },
      data: {
        processedImageKey: fullKey,
        thumbnailKey: thumbKey,
        processingStatus: "DONE",
        // Measured, not assumed: the composite needs to know how much of the canvas is
        // garment and how much is padding.
        renderWidth: fitted.width,
        renderHeight: fitted.height,
      },
    });
    await recordJob(client, item.id, { status: "DONE", step: null, error: null });

    return { ok: true, fullKey, thumbKey, trimmedSize, fitted };
  } catch (error) {
    const description = describeError(error);

    // Recorded so the item keeps showing its original and a later run can retry it.
    await client.item.update({
      where: { id: item.id },
      data: { processingStatus: "FAILED" },
    });
    await recordJob(client, item.id, { status: "FAILED", error: description });

    return { ok: false, error: description };
  }
}
