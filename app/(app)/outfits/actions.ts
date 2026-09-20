"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { uniqueOutfitName } from "@/lib/outfits/naming-sync";
import { outfitSignature } from "@/lib/outfits/signature";
import { CATEGORY_SLOT } from "@/lib/outfits/slots";
import { canonicalize } from "@/lib/text";
import { wearInputSchema } from "@/lib/validation/wear";
import type { WearResult } from "@/app/(app)/wears/actions";

export type OutfitResult =
  | { ok: true }
  | { ok: false; message: string; duplicateOf?: string };

/** Tags snap to a spelling already in use, the same way item tags do. */
async function connectOutfitTags(userId: string, tagNames: readonly string[]) {
  const vocabulary = (
    await db.tag.findMany({ where: { userId }, select: { name: true } })
  ).map((tag) => tag.name);

  const unique = new Map<string, string>();
  for (const raw of tagNames) {
    const canonical = canonicalize(raw, vocabulary);
    if (canonical) unique.set(canonical.toLowerCase(), canonical);
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

  if (itemIds.length === 0) return { ok: false, message: "Pick at least one piece." };

  // Scope by userId so a guessed UUID can't pull another closet's items into an outfit.
  const items = await db.item.findMany({
    where: { id: { in: itemIds }, userId: user.id },
    select: { id: true, category: true, subcategory: true, colors: true },
  });
  if (items.length !== itemIds.length) {
    return { ok: false, message: "One of those pieces is no longer in your closet." };
  }

  // Naming is optional. It's the one part of saving an outfit the app can't infer well,
  // and requiring it turns a two-tap action into a writing task — so a blank field falls
  // back to the same suggestion the builder offers.
  const finalName = name || (await uniqueOutfitName(user.id, items));

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

  const tags = await connectOutfitTags(user.id, tagNames);

  const outfit = await db.outfit.create({
    data: {
      userId: user.id,
      name: finalName,
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

/**
 * Change which pieces an outfit contains.
 *
 * Edits create a **new version** and supersede the old one rather than mutating it, so
 * wear history stays attached to the exact combination that was actually worn — that is
 * decision 1, and the reason `OutfitVersion` exists at all. A wear logged last month
 * still points at what was worn last month.
 *
 * Changing nothing but the name or tags reuses the current version: a new version with
 * an identical item set would be noise in the history.
 */
export async function updateOutfit(
  outfitId: string,
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

  if (itemIds.length === 0) return { ok: false, message: "Pick at least one piece." };

  const outfit = await db.outfit.findFirst({
    where: { id: outfitId, userId: user.id },
    select: { id: true, currentVersionId: true, currentVersion: { select: { signature: true } } },
  });
  if (!outfit) return { ok: false, message: "That outfit no longer exists." };

  const items = await db.item.findMany({
    where: { id: { in: itemIds }, userId: user.id },
    select: { id: true, category: true, subcategory: true, colors: true },
  });
  if (items.length !== itemIds.length) {
    return { ok: false, message: "One of those pieces is no longer in your closet." };
  }

  const signature = outfitSignature(items.map((item) => item.id));

  // Another outfit already being this exact combination is the duplicate worth warning
  // about; this outfit still being itself is not.
  const clash = await db.outfitVersion.findFirst({
    where: {
      signature,
      supersededAt: null,
      outfit: { userId: user.id, NOT: { id: outfit.id } },
    },
    select: { outfit: { select: { name: true } } },
  });
  if (clash) {
    return {
      ok: false,
      message: "Another outfit is already this exact combination.",
      duplicateOf: clash.outfit.name,
    };
  }

  const tags = await connectOutfitTags(user.id, tagNames);
  const finalName = name || (await uniqueOutfitName(user.id, items, outfit.id));

  if (signature !== outfit.currentVersion?.signature) {
    const version = await db.outfitVersion.create({
      data: {
        outfitId: outfit.id,
        signature,
        items: {
          create: items.map((item, index) => ({
            itemId: item.id,
            slot: CATEGORY_SLOT[item.category].slot,
            order: index,
          })),
        },
      },
      select: { id: true },
    });

    // Superseded, not deleted: wear logs still reference it.
    if (outfit.currentVersionId) {
      await db.outfitVersion.update({
        where: { id: outfit.currentVersionId },
        data: { supersededAt: new Date() },
      });
    }

    await db.outfit.update({
      where: { id: outfit.id },
      data: { currentVersionId: version.id },
    });
  }

  await db.outfit.update({
    where: { id: outfit.id },
    data: {
      name: finalName,
      tags: { deleteMany: {}, create: tags.map((tag) => ({ tagId: tag.id })) },
    },
  });

  revalidatePath("/outfits");
  revalidatePath(`/outfits/${outfit.id}`);
  redirect(`/outfits/${outfit.id}`);
}

/**
 * Record that an outfit was worn on a day.
 *
 * Idempotent per day like item wears are, and it writes the item rows too — so a
 * garment's own wear count and cost-per-wear include the times it was worn as part of
 * an outfit, which is the whole point of tracking outfits at all.
 */
export async function logOutfitWear(
  outfitId: string,
  _prev: WearResult | null,
  formData: FormData,
): Promise<WearResult> {
  const user = await requireUser();

  const parsed = wearInputSchema.safeParse({
    wornOn: formData.get("wornOn") ?? "",
    note: formData.get("note") ?? undefined,
  });
  if (!parsed.success) {
    return {
      ok: false,
      message: "That wear couldn't be saved.",
      fieldErrors: parsed.error.flatten().fieldErrors as Record<string, string[]>,
    };
  }

  const outfit = await db.outfit.findFirst({
    where: { id: outfitId, userId: user.id },
    select: {
      id: true,
      currentVersionId: true,
      currentVersion: { select: { items: { select: { itemId: true } } } },
    },
  });
  if (!outfit) return { ok: false, message: "That outfit no longer exists." };

  const { wornOn, note } = parsed.data;
  const itemIds = outfit.currentVersion?.items.map((link) => link.itemId) ?? [];

  const existing = await db.wearLog.findFirst({
    where: { userId: user.id, wornOn, outfitId: outfit.id },
    select: { id: true },
  });

  const wearLogId =
    existing?.id ??
    (
      await db.wearLog.create({
        data: {
          userId: user.id,
          wornOn,
          note,
          outfitId: outfit.id,
          // Pinned to the version worn, so a later edit doesn't rewrite history.
          outfitVersionId: outfit.currentVersionId,
        },
        select: { id: true },
      })
    ).id;

  for (const itemId of itemIds) {
    await db.wearLogItem.upsert({
      where: { wearLogId_itemId: { wearLogId, itemId } },
      update: {},
      create: { wearLogId, itemId },
    });
  }

  revalidatePath("/outfits");
  revalidatePath(`/outfits/${outfitId}`);
  revalidatePath("/calendar");
  revalidatePath("/catalog");
  return { ok: true };
}

/** Remove one day's wear of an outfit, and the item rows it created. */
export async function removeOutfitWear(
  outfitId: string,
  wearLogId: string,
): Promise<WearResult> {
  const user = await requireUser();

  const log = await db.wearLog.findFirst({
    where: { id: wearLogId, userId: user.id, outfitId },
    select: { id: true },
  });
  if (!log) return { ok: false, message: "That wear no longer exists." };

  await db.wearLog.delete({ where: { id: log.id } });

  revalidatePath("/outfits");
  revalidatePath(`/outfits/${outfitId}`);
  revalidatePath("/calendar");
  revalidatePath("/catalog");
  return { ok: true };
}
