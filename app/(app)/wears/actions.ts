"use server";

import { revalidatePath } from "next/cache";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { wearInputSchema } from "@/lib/validation/wear";

export type WearResult =
  | { ok: true }
  | { ok: false; message: string; fieldErrors?: Record<string, string[]> };

/**
 * Record that an item was worn on a given day.
 *
 * Backdating is the point, not an edge case: the spec makes "add a past wear" a
 * first-class action so an occasion piece can be corrected off the neglected list
 * (spec §3). The date therefore defaults to today but accepts any past day.
 *
 * Logging is **idempotent per day**. A wear is a calendar day, so a second tap for the
 * same item and date joins the existing day rather than counting twice — otherwise
 * cost-per-wear silently drifts down with every stray tap, and it is the one number the
 * whole app is built to report.
 *
 * Loose items for one day share a single `WearLog` with no outfit attached, which is
 * what the schema's nullable `outfitId` is for. When the Phase 4 builder lands, an
 * outfit wear becomes the same row with the outfit set.
 */
export async function logItemWear(
  itemId: string,
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

  // Scope by userId as well as id so a guessed UUID can't log against another closet.
  const item = await db.item.findFirst({
    where: { id: itemId, userId: user.id },
    select: { id: true },
  });
  if (!item) return { ok: false, message: "That item no longer exists." };

  const { wornOn, note } = parsed.data;

  const existing = await db.wearLog.findFirst({
    where: { userId: user.id, wornOn, outfitId: null },
    select: { id: true },
  });

  if (existing) {
    await db.wearLogItem.upsert({
      where: { wearLogId_itemId: { wearLogId: existing.id, itemId: item.id } },
      update: {},
      create: { wearLogId: existing.id, itemId: item.id },
    });
    if (note) await db.wearLog.update({ where: { id: existing.id }, data: { note } });
  } else {
    await db.wearLog.create({
      data: { userId: user.id, wornOn, note, items: { create: { itemId: item.id } } },
    });
  }

  revalidatePath("/catalog");
  revalidatePath(`/catalog/${itemId}`);
  return { ok: true };
}

/**
 * Remove one item from one day's wear.
 *
 * Deletes the day's log entirely once its last item goes, so an empty wear can't linger
 * and show up as a blank cell in the calendar.
 */
export async function removeItemWear(itemId: string, wearLogId: string): Promise<WearResult> {
  const user = await requireUser();

  const log = await db.wearLog.findFirst({
    where: { id: wearLogId, userId: user.id },
    select: { id: true, _count: { select: { items: true } } },
  });
  if (!log) return { ok: false, message: "That wear no longer exists." };

  await db.wearLogItem.deleteMany({ where: { wearLogId: log.id, itemId } });
  if (log._count.items <= 1) {
    await db.wearLog.delete({ where: { id: log.id } });
  }

  revalidatePath("/catalog");
  revalidatePath(`/catalog/${itemId}`);
  return { ok: true };
}

/**
 * Note a compliment on a day's outfit.
 *
 * One tap, no dialog, no date picker — the whole value is that it costs nothing in the
 * moment someone says something. `delta` rather than a set, so a second compliment on
 * the same day is a second tap and a mistap is undone by the same control.
 *
 * Never goes below zero: an "undo" pressed once too often should stop at nothing,
 * not start counting backwards.
 */
export async function addCompliment(
  wearLogId: string,
  delta: number,
): Promise<{ ok: boolean; compliments: number }> {
  const user = await requireUser();

  const wear = await db.wearLog.findFirst({
    where: { id: wearLogId, userId: user.id },
    select: { id: true, compliments: true },
  });
  if (!wear) return { ok: false, compliments: 0 };

  const compliments = Math.max(0, wear.compliments + delta);
  await db.wearLog.update({ where: { id: wear.id }, data: { compliments } });

  revalidatePath("/", "layout");
  return { ok: true, compliments };
}
