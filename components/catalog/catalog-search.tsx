"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import { filterHref, type CatalogFilters } from "@/lib/items/filters";

/** Long enough that a typed word is one navigation, short enough to feel live. */
const DEBOUNCE_MS = 250;

/**
 * Search across name, brand and subcategory.
 *
 * Takes the current filters as a prop rather than reading `useSearchParams`, so this
 * needs no Suspense boundary and the rest of the catalog stays a Server Component.
 * Navigation is `replace`, not `push` — otherwise every keystroke becomes a history
 * entry and the back button has to be pressed once per character.
 */
export function CatalogSearch({ filters }: { filters: CatalogFilters }) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [value, setValue] = useState(filters.q ?? "");

  /**
   * The last value this component put into the URL.
   *
   * Without it there is no way to tell our own navigation apart from someone else's. The
   * box must adopt the URL when it changes elsewhere — back button, the "Clear filters"
   * link — but must *not* be reset by the navigation it just triggered itself, which
   * would clobber anything typed while that was in flight.
   */
  const urlQuery = filters.q ?? "";
  const [pushed, setPushed] = useState(urlQuery);

  // Adjusting state during render rather than in an effect: an effect would paint the
  // stale value for a frame first, and React supports this pattern directly.
  if (urlQuery !== pushed) {
    setPushed(urlQuery);
    setValue(urlQuery);
  }

  useEffect(() => {
    if (value === urlQuery) return;

    const timer = setTimeout(() => {
      setPushed(value);
      startTransition(() => router.replace(filterHref(filters, "q", value)));
    }, DEBOUNCE_MS);

    return () => clearTimeout(timer);
  }, [value, urlQuery, filters, router]);

  return (
    <div className="relative mt-6">
      <input
        type="search"
        value={value}
        onChange={(event) => setValue(event.target.value)}
        placeholder="Search by name, brand or type"
        aria-label="Search the closet"
        className="w-full border border-line-strong bg-surface px-4 py-3 text-ink placeholder:text-ink-subtle focus:border-ink focus:outline-none"
      />
      {pending && (
        <span
          aria-hidden
          className="label absolute right-4 top-1/2 -translate-y-1/2 text-ink-subtle"
        >
          …
        </span>
      )}
    </div>
  );
}
