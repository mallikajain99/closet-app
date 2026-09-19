"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { outfitSignature } from "@/lib/outfits/signature";
import { CATEGORY_SLOT } from "@/lib/outfits/slots";
import { canonicalize } from "@/lib/text";

export type OutfitResult =
  | { ok: true }
  | { ok: false; message: string; duplicateOf?: string };

/**
 * Save an assembled outfit.
 *
 * An outfit is a stable identity (`Outfit`) plus an exact item set (`OutfitVersion`), so
 * editing later carries wear history forward instead of forking it — decision 1. The
 * first save creates both and points `currentVersionId` at the version.
 */
export async function createOutfit(
  _prev: OutfitResult | null,
  formData: FormData,
): Promise<OutfitResult> {
  const user = await requireUser();

  const name = String(formData.get("name") ?? "").trim();
  const itemIds = formData.getAll("itemIds").map(String).filter(Boolean);
  const tagNames = formData
    .getAll("tags")
    .map((value) => String(value).trim())
    .filter(Boolean);

  if (!name) return { ok: false, message: "Give the outfit a name." };
  if (itemIds.length === 0) return { ok: false, message: "Pick at least one piece." };

  // Scope by userId so a guessed UUID can't pull another closet's items into an outfit.
  const items = await db.item.findMany({
    where: { id: { in: itemIds }, userId: user.id },
    select: { id: true, category: true },
  });
  if (items.length !== itemIds.length) {
    return { ok: false, message: "One of those pieces is no longer in your closet." };
  }

  const signature = outfitSignature(items.map((item) => item.id));

  /**
   * Duplicate detection warns, it doesn't block.
   *
   * Two outfits can legitimately converge on the same items through edits, so the
   * signature index is not unique (see the schema). But saving the same combination
   * twice by accident is the common case, and splitting its wear history across two
   * records is exactly what makes the exact-combination stats meaningless.
   */
  const existing = await db.outfitVersion.findFirst({
    where: { signature, outfit: { userId: user.id }, supersededAt: null },
    select: { outfit: { select: { name: true } } },
  });
  if (existing) {
    return {
      ok: false,
      message: "You've already saved this exact combination.",
      duplicateOf: existing.outfit.name,
    };
  }

  // Tags snap to a spelling already in use, the same way item tags do.
  const vocabulary = (
    await db.tag.findMany({ where: { userId: user.id }, select: { name: true } })
  ).map((tag) => tag.name);

  const uniqueTags = new Map<string, string>();
  for (const raw of tagNames) {
    const canonical = canonicalize(raw, vocabulary);
    if (canonical) uniqueTags.set(canonical.toLowerCase(), canonical);
  }

  const tags = await Promise.all(
    [...uniqueTags.values()].map((tagName) =>
      db.tag.upsert({
        where: { userId_name: { userId: user.id, name: tagName } },
        update: {},
        create: { userId: user.id, name: tagName },
      }),
    ),
  );

  const outfit = await db.outfit.create({
    data: {
      userId: user.id,
      name,
      tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
      versions: {
        create: {
          signature,
          items: {
            create: items.map((item, index) => ({
              itemId: item.id,
              slot: CATEGORY_SLOT[item.category].slot,
              order: index,
            })),
          },
        },
      },
    },
    select: { id: true, versions: { select: { id: true } } },
  });

  // `currentVersionId` can only be set once the version exists to point at.
  await db.outfit.update({
    where: { id: outfit.id },
    data: { currentVersionId: outfit.versions[0].id },
  });

  revalidatePath("/outfits");
  redirect(`/outfits/${outfit.id}`);
}

export async function deleteOutfit(outfitId: string) {
  const user = await requireUser();

  const existing = await db.outfit.findFirst({
    where: { id: outfitId, userId: user.id },
    select: { id: true },
  });
  if (!existing) return;

  // Versions and their items cascade; wear logs keep their row with the outfit nulled,
  // so a deleted outfit doesn't erase the fact that those clothes were worn.
  await db.outfit.delete({ where: { id: existing.id } });

  revalidatePath("/outfits");
  revalidatePath("/calendar");
  redirect("/outfits");
}
