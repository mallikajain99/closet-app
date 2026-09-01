"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createSignedUpload, deleteImage } from "@/lib/images/storage";
import { buildAttributes, itemInputSchema } from "@/lib/validation/item";

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
    silhouette: formData.get("silhouette") ?? undefined,
    tagNames: multi(formData, "tags"),
    originalImageKey: formData.get("originalImageKey") ?? undefined,
  });
}

/**
 * Resolve tag names to rows, creating any that are new.
 *
 * Tags are a single vocabulary shared by items and outfits (spec §1), so this same
 * connect-or-create runs from the outfit builder in Phase 4.
 */
async function connectTags(userId: string, tagNames: readonly string[]) {
  const unique = Array.from(new Set(tagNames.map((name) => name.trim()).filter(Boolean)));

  return Promise.all(
    unique.map((name) =>
      db.tag.upsert({
        where: { userId_name: { userId, name } },
        update: {},
        create: { userId, name },
      }),
    ),
  );
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
  const tags = await connectTags(user.id, input.tagNames);

  await db.item.create({
    data: {
      userId: user.id,
      name: input.name,
      category: input.category,
      subcategory: input.subcategory,
      brand: input.brand,
      size: input.size,
      colors: input.colors,
      seasons: input.seasons,
      priceCents: input.priceCents,
      purchaseDate: input.purchaseDate,
      sourceUrl: input.sourceUrl,
      status: input.status,
      conditionNote: input.conditionNote,
      returnByDate: input.returnByDate,
      attributes: buildAttributes(input),
      originalImageKey: input.originalImageKey,
      // Phase 2 replaces this with a real pipeline run. Until then the source image is
      // shown as-is, so the item is usable rather than stuck pending forever.
      processingStatus: "PENDING",
      tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
    },
  });

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
  const tags = await connectTags(user.id, input.tagNames);
  const imageChanged =
    input.originalImageKey && input.originalImageKey !== existing.originalImageKey;

  await db.item.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      category: input.category,
      subcategory: input.subcategory,
      brand: input.brand,
      size: input.size,
      colors: input.colors,
      seasons: input.seasons,
      priceCents: input.priceCents,
      purchaseDate: input.purchaseDate,
      sourceUrl: input.sourceUrl,
      status: input.status,
      conditionNote: input.conditionNote,
      returnByDate: input.returnByDate,
      attributes: buildAttributes(input),
      ...(imageChanged
        ? { originalImageKey: input.originalImageKey, processingStatus: "PENDING" as const }
        : {}),
      tags: { deleteMany: {}, create: tags.map((tag) => ({ tagId: tag.id })) },
    },
  });

  if (imageChanged) await deleteImage(existing.originalImageKey);

  revalidatePath("/catalog");
  revalidatePath(`/catalog/${itemId}`);
  redirect(`/catalog/${itemId}`);
}

export async function deleteItem(itemId: string) {
  const user = await requireUser();

  const existing = await db.item.findFirst({
    where: { id: itemId, userId: user.id },
    select: { id: true, originalImageKey: true, processedImageKey: true },
  });

  if (!existing) return;

  await db.item.delete({ where: { id: existing.id } });

  // After the row is gone: orphaned storage objects are recoverable, a dangling image
  // reference on a live item is not.
  await Promise.all([
    deleteImage(existing.originalImageKey),
    deleteImage(existing.processedImageKey),
  ]);

  revalidatePath("/catalog");
  redirect("/catalog");
}
