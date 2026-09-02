import Link from "next/link";

import { cn } from "@/lib/utils";
import { CATEGORY_ORDER, CATEGORY_PLURAL } from "@/lib/validation/item";
import type { Category } from "@prisma/client";

/**
 * Category filter for the catalog.
 *
 * Rendered as links rather than client state so the selection lives in the URL — the
 * back button works, a filtered view can be bookmarked, and the page stays a Server
 * Component with no hydration cost.
 *
 * Only categories that actually contain something are shown. A row of empty tabs on a
 * new closet would be noise, and the row grows naturally as the wardrobe fills out.
 */
export function CategoryFilter({
  counts,
  active,
  total,
}: {
  counts: Map<Category, number>;
  active: Category | null;
  total: number;
}) {
  const present = CATEGORY_ORDER.filter((category) => (counts.get(category) ?? 0) > 0);

  // Nothing to filter between until there are at least two kinds of thing.
  if (present.length < 2) return null;

  return (
    <nav aria-label="Filter by type" className="-mx-6 mt-6 overflow-x-auto px-6">
      <ul className="flex w-max gap-2 pb-1">
        <li>
          <Chip href="/catalog" label="Everything" count={total} active={active === null} />
        </li>
        {present.map((category) => (
          <li key={category}>
            <Chip
              href={`/catalog?category=${category}`}
              label={CATEGORY_PLURAL[category]}
              count={counts.get(category) ?? 0}
              active={active === category}
            />
          </li>
        ))}
      </ul>
    </nav>
  );
}

function Chip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count: number;
  active: boolean;
}) {
  return (
    <Link
      href={href}
      scroll={false}
      aria-current={active ? "page" : undefined}
      className={cn(
        "label inline-flex items-center gap-2 whitespace-nowrap border px-3 py-2 transition-colors",
        active
          ? "border-ink bg-ink text-canvas"
          : "border-line-strong text-ink-muted hover:border-ink hover:text-ink",
      )}
    >
      {label}
      <span className={active ? "text-canvas/60" : "text-ink-subtle"}>{count}</span>
    </Link>
  );
}
