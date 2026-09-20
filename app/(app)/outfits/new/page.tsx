import Link from "next/link";

import { createOutfit } from "@/app/(app)/outfits/actions";
import { OutfitBuilder, type PickableItem } from "@/components/outfits/outfit-builder";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { BUILDER_SLOTS } from "@/lib/outfits/slots";

export const metadata = { title: "Build an outfit" };

export default async function NewOutfitPage() {
  const user = await requireUser();

  const [items, tags] = await Promise.all([
    db.item.findMany({
      // Only what's actually wearable: something in the wash or donated shouldn't be
      // offered as a choice.
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        colors: true,
        originalImageKey: true,
        processedImageKey: true,
        thumbnailKey: true,
      },
    }),
    db.tag.findMany({ where: { userId: user.id }, orderBy: { name: "asc" }, select: { name: true } }),
  ]);

  const urls = await getItemImageUrls(items, "thumbnail");

  const itemsBySlot: Record<string, PickableItem[]> = {};
  for (const { slot, categories } of BUILDER_SLOTS) {
    itemsBySlot[slot] = items
      .filter((item) => categories.includes(item.category))
      // Grouped by kind before name: scrolling a strip of thirty-eight tops is only
      // searchable if all the sweaters sit together and all the shirts sit together.
      .sort(
        (a, b) =>
          (a.subcategory ?? "zzz").localeCompare(b.subcategory ?? "zzz") ||
          a.name.localeCompare(b.name),
      )
      .map((item) => ({
        id: item.id,
        name: item.name,
        category: item.category,
        subcategory: item.subcategory,
        colors: item.colors,
        imageUrl: urls.get(item.id) ?? null,
      }));
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href="/outfits" className="label text-ink-subtle hover:text-ink">
          ← Outfits
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">Build an outfit</h1>
      </div>

      <div className="mt-10">
        <OutfitBuilder
          itemsBySlot={itemsBySlot}
          allTags={tags.map((tag) => tag.name)}
          action={createOutfit}
        />
      </div>
    </main>
  );
}
