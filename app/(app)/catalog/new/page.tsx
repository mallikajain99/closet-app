import Link from "next/link";

import { createItem } from "@/app/(app)/catalog/actions";
import { ItemForm } from "@/components/catalog/item-form";
import { requireUser } from "@/lib/auth";
import { getSilhouetteSuggestions } from "@/lib/items/suggestions";
import { tagVocabulary } from "@/lib/tags/vocabulary";

export const metadata = { title: "Add an item" };

/**
 * Saving an item schedules the image pipeline with `after()`, which runs inside this
 * page's invocation — so the page, not the pipeline, owns the timeout. Segmentation is
 * a Replicate round trip plus two uploads: 20–60s. Raise to 300 on a Vercel plan that
 * permits it if long runs start being cut off.
 */
export const maxDuration = 60;

export default async function NewItemPage() {
  const user = await requireUser();

  const [tags, silhouetteSuggestions] = await Promise.all([
    tagVocabulary(user.id),
    getSilhouetteSuggestions(user.id),
  ]);

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href="/catalog" className="label text-ink-subtle hover:text-ink">
          ← Closet
        </Link>
        <h1 className="mt-3 text-3xl font-light tracking-tight">Add an item</h1>
      </div>

      <div className="mt-10">
        <ItemForm
          action={createItem}
          submitLabel="Save item"
          allTags={tags}
          silhouetteSuggestions={silhouetteSuggestions}
        />
      </div>
    </main>
  );
}
