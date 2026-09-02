import Link from "next/link";
import { notFound } from "next/navigation";

import { updateItem } from "@/app/(app)/catalog/actions";
import { ItemForm } from "@/components/catalog/item-form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";
import { getSignedImageUrl } from "@/lib/images/storage";
import { getSilhouetteSuggestions } from "@/lib/items/suggestions";
import { readSilhouette } from "@/lib/validation/item";

export const metadata = { title: "Edit item" };

export default async function EditItemPage(
  props: PageProps<"/catalog/[itemId]/edit">,
) {
  const { itemId } = await props.params;
  const user = await requireUser();

  const [item, tags, silhouetteSuggestions] = await Promise.all([
    db.item.findFirst({
      where: { id: itemId, userId: user.id },
      include: { tags: { include: { tag: true } } },
    }),
    db.tag.findMany({
      where: { userId: user.id },
      orderBy: { name: "asc" },
      select: { name: true },
    }),
    getSilhouetteSuggestions(user.id),
  ]);

  if (!item) notFound();

  const imageUrl = await getSignedImageUrl(item.originalImageKey);

  // Bind the id server-side so the form can't be edited to target another item.
  const action = updateItem.bind(null, item.id);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href={`/catalog/${item.id}`} className="label text-ink-subtle hover:text-ink">
          ← {item.name}
        </Link>
        <h1 className="mt-3 text-3xl font-light tracking-tight">Edit item</h1>
      </div>

      <div className="mt-10">
        <ItemForm
          action={action}
          submitLabel="Save changes"
          allTags={tags.map((tag) => tag.name)}
          silhouetteSuggestions={silhouetteSuggestions}
          imageUrl={imageUrl}
          values={{
            id: item.id,
            name: item.name,
            category: item.category,
            subcategory: item.subcategory,
            brand: item.brand,
            size: item.size,
            colors: item.colors,
            seasons: item.seasons,
            priceCents: item.priceCents,
            purchaseDate: item.purchaseDate,
            sourceUrl: item.sourceUrl,
            status: item.status,
            conditionNote: item.conditionNote,
            returnByDate: item.returnByDate,
            attributes: (item.attributes ?? {}) as Record<string, string>,
            silhouette: readSilhouette(item.attributes),
            tagNames: item.tags.map((link) => link.tag.name),
            originalImageKey: item.originalImageKey,
          }}
        />
      </div>
    </main>
  );
}
