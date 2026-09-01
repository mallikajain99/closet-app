import Link from "next/link";

import { createItem } from "@/app/(app)/catalog/actions";
import { ItemForm } from "@/components/catalog/item-form";
import { requireUser } from "@/lib/auth";
import { db } from "@/lib/db";

export const metadata = { title: "Add an item" };

export default async function NewItemPage() {
  const user = await requireUser();

  const tags = await db.tag.findMany({
    where: { userId: user.id },
    orderBy: { name: "asc" },
    select: { name: true },
  });

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
          allTags={tags.map((tag) => tag.name)}
        />
      </div>
    </main>
  );
}
