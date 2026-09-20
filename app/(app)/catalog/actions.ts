"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { PROCESSED_BUCKET } from "@/lib/images/storage.client";
import { createSignedUpload, deleteImage } from "@/lib/images/storage";
import { processItemImage } from "@/lib/images/pipeline";
import {
  captureAutoNamedOutfits,
  refreshOutfitNames,
} from "@/lib/outfits/naming-sync";
import { canonicalize, normalizeSize, normalizeTitle } from "@/lib/text";
import {
  buildAttributes,
  fieldApplies,
  itemInputSchema,
  type ItemInput,
} from "@/lib/validation/item";

export type ActionResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Mint an upload URL for the browser to PUT a photo directly to storage.
 *
 * Files never pass through a Server Action — phone photos routinely exceed Vercel's
 * 4.5 MB request body limit.
 */
export async function requestUploadUrl(fileName: string) {
  const user = await requireUser();
  return createSignedUpload(user.id, fileName);
}

/** Parse a multi-value form field that the client submits as repeated entries. */
function multi(formData: FormData, name: string) {
  return formData
    .getAll(name)
    .map((value) => String(value).trim())
    .filter(Boolean);
}

function parseItemForm(formData: FormData) {
  return itemInputSchema.safeParse({
    name: formData.get("name") ?? "",
    category: formData.get("category") ?? undefined,
    subcategory: formData.get("subcategory") ?? undefined,
    brand: formData.get("brand") ?? undefined,
    size: formData.get("size") ?? undefined,
    colors: multi(formData, "colors"),
    seasons: multi(formData, "seasons"),
    priceCents: formData.get("price") ?? undefined,
    purchaseDate: formData.get("purchaseDate") ?? undefined,
    sourceUrl: formData.get("sourceUrl") ?? undefined,
    status: formData.get("status") ?? "ACTIVE",
    conditionNote: formData.get("conditionNote") ?? undefined,
    returnByDate: formData.get("returnByDate") ?? undefined,
    sleeveLength: formData.get("sleeveLength") ?? undefined,
    formality: formData.get("formality") ?? undefined,
    material: formData.get("material") ?? undefined,
    pattern: formData.get("pattern") ?? undefined,
    silhouette: multi(formData, "silhouette"),
    tagNames: multi(formData, "tags"),
    originalImageKey: formData.get("originalImageKey") ?? undefined,
  });
}

/**
 * Snap free-text fields onto spellings the user has already used.
 *
 * Without this, "Everlane", "everlane", and "EVERLANE" become three distinct brands, and
 * the brand filter splits one label across three rows. Existing spellings win rather than
 * any casing rule, because brand capitalisation is idiosyncratic — COS, ba&sh, lululemon
 * would all be mangled by title-casing. See lib/text.ts.
 */
async function canonicalizeFields(userId: string, input: ItemInput) {
  const [brands, sizes, subcategories, materials, patterns] = await Promise.all(
    (["brand", "size", "subcategory", "material", "pattern"] as const).map(
      async (field) => {
        // `material` and `pattern` live inside the attributes JSON, not their own column.
        if (field === "material" || field === "pattern") {
          const rows = await db.item.findMany({
            where: { userId },
            select: { attributes: true },
          });
          const seen = new Set<string>();
          for (const row of rows) {
            const value = (row.attributes as Record<string, unknown>)?.[field];
            if (typeof value === "string" && value) seen.add(value);
          }
          return [...seen];
        }

        const rows = await db.item.findMany({
          where: { userId, NOT: { [field]: null } },
          select: { [field]: true },
          distinct: [field],
        });
        return rows
          .map((row) => (row as Record<string, unknown>)[field])
          .filter((value): value is string => typeof value === "string");
      },
    ),
  );

  const brand = canonicalize(input.brand, brands);

  return {
    brand,
    size: normalizeSize(input.size, sizes),
    subcategory: canonicalize(input.subcategory, subcategories),
    material: canonicalize(input.material, materials),
    pattern: canonicalize(input.pattern, patterns),
    // Sentence case however it was typed, with brand names left in their own spelling.
    // This item's own brand is included even when it is new to the closet, so the first
    // item from a label doesn't have it lowercased out of its title.
    name: normalizeTitle(input.name, brand ? [...brands, brand] : brands),
  };
}

/**
 * Resolve tag names to rows, creating any that are new.
 *
 * Tags are a single vocabulary shared by items and outfits (spec §1), so this same
 * connect-or-create runs from the outfit builder in Phase 4.
 *
 * Names are snapped to a spelling already in use, the same way brands are: the uniqueness
 * constraint is exact, so without this "Work" and "work" become two tags, split the items
 * between them, and both show up in the tag picker. Existing spelling wins rather than any
 * casing rule — the user's own capitalisation is the intent.
 */
async function connectTags(userId: string, tagNames: readonly string[]) {
  const existing = await db.tag.findMany({ where: { userId }, select: { name: true } });
  const vocabulary = existing.map((tag) => tag.name);

  const unique = new Map<string, string>();
  for (const raw of tagNames) {
    const name = canonicalize(raw, vocabulary);
    if (!name) continue;
    // Dedupe case-insensitively too, so one submission can't carry both variants.
    unique.set(name.toLowerCase(), name);
  }

  return Promise.all(
    [...unique.values()].map((name) =>
      db.tag.upsert({
        where: { userId_name: { userId, name } },
        update: {},
        create: { userId, name },
      }),
    ),
  );
}

/**
 * Queue the image pipeline for an item without making the user wait for it.
 *
 * `after` keeps the invocation alive until the callback settles, so on Vercel the work
 * really does finish — but it counts against the route's `maxDuration`, which is why
 * the catalog segments raise theirs. Segmentation is a round trip to Replicate plus two
 * uploads, so 20–60s is normal. The pipeline never throws; it records FAILED and the
 * item keeps showing its original photo, which the catalog can then offer to retry.
 */
function scheduleProcessing(itemId: string) {
  after(async () => {
    const result = await processItemImage(itemId);
    if (!result.ok) console.error(`Image pipeline failed for ${itemId}: ${result.error}`);
  });
}

export async function createItem(
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseItemForm(formData);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Some fields need attention.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const input = parsed.data;
  const [tags, canonical] = await Promise.all([
    connectTags(user.id, input.tagNames),
    canonicalizeFields(user.id, input),
  ]);

  const created = await db.item.create({
    select: { id: true },
    data: {
      userId: user.id,
      name: canonical.name,
      category: input.category,
      subcategory: canonical.subcategory,
      brand: canonical.brand,
      // Cleared when the category has no sizes — see fieldApplies in lib/validation/item.
      size: fieldApplies("size", input.category) ? canonical.size : null,
      colors: input.colors,
      seasons: input.seasons,
      priceCents: input.priceCents,
      purchaseDate: input.purchaseDate,
      sourceUrl: input.sourceUrl,
      status: input.status,
      conditionNote: input.conditionNote,
      returnByDate: input.returnByDate,
      attributes: buildAttributes(input, canonical),
      originalImageKey: input.originalImageKey,
      // The pipeline flips this to DONE below. Until it does, the catalog shows the
      // source image, so a new item is usable immediately rather than blank.
      processingStatus: "PENDING",
      tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
    },
  });

  if (input.originalImageKey) scheduleProcessing(created.id);

  revalidatePath("/catalog");
  redirect("/catalog");
}

export async function updateItem(
  itemId: string,
  _prev: ActionResult | null,
  formData: FormData,
): Promise<ActionResult> {
  const user = await requireUser();
  const parsed = parseItemForm(formData);

  if (!parsed.success) {
    return {
      ok: false,
      message: "Some fields need attention.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  // Scope by userId as well as id so a guessed UUID can't reach another user's item.
  const existing = await db.item.findFirst({
    where: { id: itemId, userId: user.id },
    select: { id: true, originalImageKey: true },
  });

  if (!existing) return { ok: false, message: "That item no longer exists." };

  const input = parsed.data;
  const [tags, canonical, autoNamedOutfits] = await Promise.all([
    connectTags(user.id, input.tagNames),
    canonicalizeFields(user.id, input),
    // Must be read before the item changes: an auto-generated outfit name is
    // recognised by matching the suggestions for the item's *old* values.
    captureAutoNamedOutfits(user.id, itemId),
  ]);
  const imageChanged =
    input.originalImageKey && input.originalImageKey !== existing.originalImageKey;

  await db.item.update({
    where: { id: existing.id },
    data: {
      name: canonical.name,
      category: input.category,
      subcategory: canonical.subcategory,
      brand: canonical.brand,
      // Cleared when the category has no sizes — see fieldApplies in lib/validation/item.
      size: fieldApplies("size", input.category) ? canonical.size : null,
      colors: input.colors,
      seasons: input.seasons,
      priceCents: input.priceCents,
      purchaseDate: input.purchaseDate,
      sourceUrl: input.sourceUrl,
      status: input.status,
      conditionNote: input.conditionNote,
      returnByDate: input.returnByDate,
      attributes: buildAttributes(input, canonical),
      ...(imageChanged
        ? { originalImageKey: input.originalImageKey, processingStatus: "PENDING" as const }
        : {}),
      tags: { deleteMany: {}, create: tags.map((tag) => ({ tagId: tag.id })) },
    },
  });

  if (imageChanged) {
    await deleteImage(existing.originalImageKey);
    scheduleProcessing(existing.id);
  }

  // Outfits named after this garment follow it; ones the user named do not.
  await refreshOutfitNames(autoNamedOutfits);

  revalidatePath("/catalog");
  revalidatePath("/outfits");
  revalidatePath(`/catalog/${itemId}`);
  redirect(`/catalog/${itemId}`);
}

/** Scope by userId as well as id so a guessed UUID can't reach another user's item. */
async function findOwnedItem(itemId: string, userId: string) {
  return db.item.findFirst({
    where: { id: itemId, userId },
    select: { id: true, originalImageKey: true, processingStatus: true },
  });
}

/**
 * Manual override — re-run the pipeline on an item the user isn't happy with.
 *
 * Also the retry path for a FAILED item, and the way an OVERRIDDEN item comes back into
 * the pipeline if the user changes their mind.
 */
export async function reprocessItem(itemId: string): Promise<ActionResult> {
  const user = await requireUser();
  const existing = await findOwnedItem(itemId, user.id);

  if (!existing) return { ok: false, message: "That item no longer exists." };
  if (!existing.originalImageKey) {
    return { ok: false, message: "This item has no photo to process." };
  }

  await db.item.update({
    where: { id: existing.id },
    data: { processingStatus: "PENDING" },
  });
  scheduleProcessing(existing.id);

  revalidatePath("/catalog");
  revalidatePath(`/catalog/${itemId}`);
  return { ok: true };
}

/**
 * Manual override — reject the cut-out and keep the source photo.
 *
 * The render is deleted rather than merely unreferenced, so the catalog can't quietly
 * fall back to a version the user has already rejected. OVERRIDDEN is excluded from
 * backfill runs, so this decision survives a `--redo`.
 */
export async function keepOriginalImage(itemId: string): Promise<ActionResult> {
  const user = await requireUser();

  const existing = await db.item.findFirst({
    where: { id: itemId, userId: user.id },
    select: { id: true, processedImageKey: true, thumbnailKey: true },
  });

  if (!existing) return { ok: false, message: "That item no longer exists." };

  await db.item.update({
    where: { id: existing.id },
    data: {
      processingStatus: "OVERRIDDEN",
      processedImageKey: null,
      thumbnailKey: null,
    },
  });

  await Promise.all([
    deleteImage(existing.processedImageKey, PROCESSED_BUCKET),
    deleteImage(existing.thumbnailKey, PROCESSED_BUCKET),
  ]);

  revalidatePath("/catalog");
  revalidatePath(`/catalog/${itemId}`);
  return { ok: true };
}

export async function deleteItem(itemId: string) {
  const user = await requireUser();

  const existing = await db.item.findFirst({
    where: { id: itemId, userId: user.id },
    select: {
      id: true,
      originalImageKey: true,
      processedImageKey: true,
      thumbnailKey: true,
    },
  });

  if (!existing) return;

  await db.item.delete({ where: { id: existing.id } });

  // After the row is gone: orphaned storage objects are recoverable, a dangling image
  // reference on a live item is not. The renders live in their own bucket, so they need
  // the bucket named explicitly — the default is the originals bucket.
  await Promise.all([
    deleteImage(existing.originalImageKey),
    deleteImage(existing.processedImageKey, PROCESSED_BUCKET),
    deleteImage(existing.thumbnailKey, PROCESSED_BUCKET),
  ]);

  revalidatePath("/catalog");
  redirect("/catalog");
}
