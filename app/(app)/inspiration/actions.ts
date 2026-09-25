"use server";

import { revalidatePath } from "next/cache";
import { redirect } from "next/navigation";
import { after } from "next/server";

import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { matchPiece } from "@/lib/inspiration/match";
import { readInspiration } from "@/lib/inspiration/read";
import { createSignedUpload, deleteImage, getSignedImageUrl } from "@/lib/images/storage";

/** Mint a one-time upload URL; the browser PUTs the file straight to storage. */
export async function requestInspirationUpload(fileName: string) {
  const user = await requireUser();
  const { key, token } = await createSignedUpload(user.id, fileName);
  return { key, token };
}

/**
 * Read an inspiration and match what it contains against the closet.
 *
 * Split out from creation so it can be re-run: the reader is a model and will
 * sometimes miss a piece, and the closet changes underneath an inspiration saved
 * months ago.
 *
 * Pieces the user has confirmed or corrected by hand are left alone, which is what
 * makes re-running safe — otherwise a second pass would quietly undo her decisions.
 */
export async function analyseInspiration(inspirationId: string) {
  const inspiration = await db.inspiration.findUnique({
    where: { id: inspirationId },
    select: { id: true, userId: true, imageKey: true },
  });
  if (!inspiration) return;

  try {
    await db.inspiration.update({
      where: { id: inspiration.id },
      data: { status: "PROCESSING", error: null },
    });

    const imageUrl = await getSignedImageUrl(inspiration.imageKey);
    if (!imageUrl) throw new Error("Could not read the uploaded image.");

    const [pieces, closet, confirmed] = await Promise.all([
      readInspiration(imageUrl),
      db.item.findMany({
        where: { userId: inspiration.userId, status: "ACTIVE" },
        select: { id: true, name: true, category: true, subcategory: true, colors: true },
      }),
      db.inspirationPiece.findMany({
        where: { inspirationId: inspiration.id, confirmed: true },
        select: { id: true },
      }),
    ]);

    // Replace only the pieces the user hasn't touched.
    await db.inspirationPiece.deleteMany({
      where: { inspirationId: inspiration.id, confirmed: false },
    });

    const offset = confirmed.length;
    await db.inspirationPiece.createMany({
      data: pieces.map((piece, index) => {
        const result = matchPiece(piece, closet);
        return {
          inspirationId: inspiration.id,
          description: piece.description,
          category: piece.category,
          color: piece.color,
          match: result.match,
          matchedItemId: result.itemId,
          order: offset + index,
        };
      }),
    });

    await db.inspiration.update({
      where: { id: inspiration.id },
      data: { status: "DONE", error: null },
    });
  } catch (cause) {
    await db.inspiration.update({
      where: { id: inspiration.id },
      data: {
        status: "FAILED",
        error: cause instanceof Error ? cause.message.slice(0, 500) : "Unknown error",
      },
    });
  }

  revalidatePath("/inspiration");
  revalidatePath(`/inspiration/${inspirationId}`);
}

export async function createInspiration(formData: FormData) {
  const user = await requireUser();

  const imageKey = String(formData.get("imageKey") ?? "").trim();
  if (!imageKey) return;

  const sourceUrl = String(formData.get("sourceUrl") ?? "").trim() || null;
  const note = String(formData.get("note") ?? "").trim() || null;

  const inspiration = await db.inspiration.create({
    data: { userId: user.id, imageKey, sourceUrl, note },
    select: { id: true },
  });

  // Reading takes 10–30s, which is not a page load. Same pattern as item cutouts.
  after(() => analyseInspiration(inspiration.id));

  revalidatePath("/inspiration");
  redirect(`/inspiration/${inspiration.id}`);
}

export async function deleteInspiration(inspirationId: string) {
  const user = await requireUser();

  const inspiration = await db.inspiration.findFirst({
    where: { id: inspirationId, userId: user.id },
    select: { id: true, imageKey: true },
  });
  if (!inspiration) return;

  await db.inspiration.delete({ where: { id: inspiration.id } });
  await deleteImage(inspiration.imageKey);

  revalidatePath("/inspiration");
  redirect("/inspiration");
}

/**
 * Correct a match by hand.
 *
 * Always available, because a wrong automatic match is worse than no match: it removes
 * something from the shopping list without telling anyone. Marking it confirmed also
 * protects the correction from the next re-run.
 */
export async function setPieceMatch(
  pieceId: string,
  match: "MISSING" | "CLOSE" | "OWNED",
  matchedItemId: string | null,
) {
  const user = await requireUser();

  const piece = await db.inspirationPiece.findFirst({
    where: { id: pieceId, inspiration: { userId: user.id } },
    select: { id: true, inspirationId: true },
  });
  if (!piece) return { ok: false };

  await db.inspirationPiece.update({
    where: { id: piece.id },
    data: {
      match,
      matchedItemId: match === "MISSING" ? null : matchedItemId,
      confirmed: true,
    },
  });

  revalidatePath("/inspiration", "layout");
  return { ok: true };
}

/**
 * Mark a wanted piece as bought.
 *
 * Deliberately does *not* add anything to the catalog. Buying and cataloguing are
 * separate acts, and a wish list that quietly became inventory would have
 * cost-per-wear counting clothes nobody owns.
 */
export async function markPieceBought(pieceId: string, bought: boolean) {
  const user = await requireUser();

  const piece = await db.inspirationPiece.findFirst({
    where: { id: pieceId, inspiration: { userId: user.id } },
    select: { id: true },
  });
  if (!piece) return { ok: false };

  await db.inspirationPiece.update({
    where: { id: piece.id },
    data: { boughtAt: bought ? new Date() : null },
  });

  revalidatePath("/inspiration", "layout");
  return { ok: true };
}
