import Image from "next/image";
import Link from "next/link";

import { PROCESSING_BADGE } from "@/lib/images/status";
import { costPerWearCents, formatCents } from "@/lib/stats/cost-per-wear";
import { CATEGORY_LABELS } from "@/lib/validation/item";
import type { Category, ItemStatus, ProcessingStatus } from "@prisma/client";

export type ItemCardData = {
  id: string;
  name: string;
  category: Category;
  brand: string | null;
  priceCents: number | null;
  status: ItemStatus;
  processingStatus: ProcessingStatus;
  wearCount: number;
  imageUrl: string | null;
};

export function ItemCard({ item }: { item: ItemCardData }) {
  const cpw = costPerWearCents(item.priceCents, item.wearCount);
  const unavailable = item.status !== "ACTIVE";
  // Only meaningful once there's a photo — an item with no image has nothing to process.
  const processing = item.imageUrl ? PROCESSING_BADGE[item.processingStatus] : undefined;

  return (
    <li>
      <Link href={`/catalog/${item.id}`} className="group block">
        <div className="relative aspect-[3/4] overflow-hidden bg-surface-sunken">
          {item.imageUrl ? (
            <Image
              src={item.imageUrl}
              alt=""
              fill
              unoptimized
              sizes="(max-width: 640px) 50vw, (max-width: 1024px) 33vw, 240px"
              className={
                unavailable
                  ? "object-cover opacity-40 transition-opacity"
                  : "object-cover transition-opacity group-hover:opacity-90"
              }
            />
          ) : (
            <span className="label absolute inset-0 flex items-center justify-center text-ink-subtle">
              No photo
            </span>
          )}

          {unavailable && (
            <span className="label absolute left-0 top-0 bg-signal-laundry-soft px-2 py-1 text-signal-laundry">
              {item.status === "LAUNDRY" ? "In wash" : "Unavailable"}
            </span>
          )}

          {/* Opposite corner from the laundry badge so the two can coexist. */}
          {processing && (
            <span
              className={`label absolute right-0 top-0 px-2 py-1 ${processing.className}`}
            >
              {processing.label}
            </span>
          )}
        </div>

        <p className="mt-2 truncate text-ink">{item.name}</p>
        <p className="text-meta text-ink-subtle">
          {item.brand ?? CATEGORY_LABELS[item.category]}
        </p>
        {cpw !== null && (
          <p className="text-meta text-ink-muted">
            {formatCents(cpw)}/wear
            {item.wearCount === 0 && (
              <span className="text-ink-subtle"> · not worn yet</span>
            )}
          </p>
        )}
      </Link>
    </li>
  );
}
