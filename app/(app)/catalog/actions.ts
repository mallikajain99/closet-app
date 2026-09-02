"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { createSignedUpload, deleteImage } from "@/lib/images/storage";
import { canonicalize, normalizeSize } from "@/lib/text";
import { buildAttributes, itemInputSchema, type ItemInput } from "@/lib/validation/item";

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

  return {
    brand: canonicalize(input.brand, brands),
    size: normalizeSize(input.size, sizes),
    subcategory: canonicalize(input.subcategory, subcategories),
    material: canonicalize(input.material, materials),
    pattern: canonicalize(input.pattern, patterns),
  };
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
  const [tags, canonical] = await Promise.all([
    connectTags(user.id, input.tagNames),
    canonicalizeFields(user.id, input),
  ]);

  await db.item.create({
    data: {
      userId: user.id,
      name: input.name,
      category: input.category,
      subcategory: canonical.subcategory,
      brand: canonical.brand,
      size: canonical.size,
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
  const [tags, canonical] = await Promise.all([
    connectTags(user.id, input.tagNames),
    canonicalizeFields(user.id, input),
  ]);
  const imageChanged =
    input.originalImageKey && input.originalImageKey !== existing.originalImageKey;

  await db.item.update({
    where: { id: existing.id },
    data: {
      name: input.name,
      category: input.category,
      subcategory: canonical.subcategory,
      brand: canonical.brand,
      size: canonical.size,
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
