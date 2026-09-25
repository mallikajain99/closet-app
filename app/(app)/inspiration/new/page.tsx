import Link from "next/link";

import { InspirationForm } from "@/components/inspiration/inspiration-form";
import { requireUser } from "@/lib/auth";

export const metadata = { title: "Add inspiration" };

/** Reading an inspiration runs a model in `after()`, so this route needs the headroom. */
export const maxDuration = 120;

export default async function NewInspirationPage() {
  await requireUser();

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-12">
      <div className="border-b border-line pb-6">
        <Link href="/inspiration" className="label text-ink-subtle hover:text-ink">
          ← Inspiration
        </Link>
        <h1 className="mt-4 text-3xl font-light tracking-tight">Add an inspiration</h1>
        <p className="mt-1 max-w-md text-meta leading-relaxed text-ink-muted">
          A photo of an outfit you&rsquo;d like to wear. The app reads the garments out
          of it and checks each against your closet.
        </p>
      </div>

      <InspirationForm />
    </main>
  );
}
