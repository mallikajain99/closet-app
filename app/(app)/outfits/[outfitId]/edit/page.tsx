import Link from "next/link";
import { notFound } from "next/navigation";

import { updateOutfit } from "@/app/(app)/outfits/actions";
import { OutfitBuilder, type PickableItem } from "@/components/outfits/outfit-builder";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getItemImageUrls } from "@/lib/images/storage";
import { BUILDER_SLOTS } from "@/lib/outfits/slots";
import { tagVocabulary } from "@/lib/tags/vocabulary";

export const metadata = { title: "Edit outfit" };

export default async function EditOutfitPage(props: PageProps<"/outfits/[outfitId]/edit">) {
  const { outfitId } = await props.params;
  const user = await requireUser();

  const [outfit, items, tags] = await Promise.all([
    db.outfit.findFirst({
      where: { id: outfitId, userId: user.id },
      select: {
        id: true,
        name: true,
        tags: { select: { tag: { select: { name: true } } } },
        currentVersion: { select: { items: { select: { itemId: true } } } },
      },
    }),
    db.item.findMany({
      where: { userId: user.id, status: "ACTIVE" },
      orderBy: { name: "asc" },
      select: {
        id: true,
        name: true,
        category: true,
        subcategory: true,
        colors: true,
        renderHeight: true,
        renderWidth: true,
        originalImageKey: true,
        processedImageKey: true,
        thumbnailKey: true,
      },
    }),
    tagVocabulary(user.id),
  ]);

  if (!outfit) notFound();

  const urls = await getItemImageUrls(items, "thumbnail");

  const itemsBySlot: Record<string, PickableItem[]> = {};
  for (const { slot, categories } of BUILDER_SLOTS) {
    itemsBySlot[slot] = items
      .filter((item) => categories.includes(item.category))
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
        renderHeight: item.renderHeight,
        renderWidth: item.renderWidth,
        imageUrl: urls.get(item.id) ?? null,
      }));
  }

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href={`/outfits/${outfit.id}`} className="label text-ink-subtle hover:text-ink">
          ← {outfit.name}
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">Edit outfit</h1>
        <p className="mt-1 text-meta text-ink-subtle">
          Changing the pieces keeps this outfit&rsquo;s wear history — past wears stay
          attached to what was actually worn on the day.
        </p>
      </div>

      <div className="mt-10">
        <OutfitBuilder
          itemsBySlot={itemsBySlot}
          allTags={tags}
          action={updateOutfit.bind(null, outfit.id)}
          initialItemIds={outfit.currentVersion?.items.map((link) => link.itemId) ?? []}
          initialName={outfit.name}
          initialTags={outfit.tags.map(({ tag }) => tag.name)}
          submitLabel="Save changes"
        />
      </div>
    </main>
  );
}
