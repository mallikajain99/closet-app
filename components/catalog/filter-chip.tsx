import Link from "next/link";

import { cn } from "@/lib/utils";

/**
 * One filter chip. Shared by the category row and the facet rows so the whole filter
 * area reads as a single control rather than several that merely resemble each other.
 *
 * A link, not a button: the selection lives in the URL (see lib/items/filters.ts).
 */
export function FilterChip({
  href,
  label,
  count,
  active,
}: {
  href: string;
  label: string;
  count?: number;
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
      {count !== undefined && (
        <span className={active ? "text-canvas/60" : "text-ink-subtle"}>{count}</span>
      )}
    </Link>
  );
}
