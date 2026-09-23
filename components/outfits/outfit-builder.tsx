"use client";

import Image from "next/image";
import { useActionState, useMemo, useState } from "react";

import type { OutfitResult } from "@/app/(app)/outfits/actions";
import { OutfitFigure } from "@/components/outfits/outfit-figure";
import { ChipListInput } from "@/components/ui/chip-list-input";
import { suggestOutfitNames } from "@/lib/outfits/name";
import { BUILDER_SLOTS } from "@/lib/outfits/slots";
import type { Category, Slot } from "@prisma/client";

export type PickableItem = {
  id: string;
  name: string;
  category: Category;
  subcategory: string | null;
  colors: string[];
  renderHeight: number | null;
  renderWidth: number | null;
  imageUrl: string | null;
};

/**
 * Assemble an outfit from the catalog.
 *
 * Selection is client state so the preview updates on tap; only the save crosses to the
 * server. Each slot is a horizontal strip rather than a grid — scanning twenty tops
 * sideways is the interaction the spec asks for, and it keeps the preview on screen
 * while you choose, which is the entire point of a live preview.
 */
/**
 * Split a slot's items into a row per kind — jeans, trousers, skirts.
 *
 * Alphabetical rather than by size: the rows keep the same position every visit, which
 * matters more than putting the biggest first when you come back to this repeatedly.
 */
function groupBySubcategory(items: readonly PickableItem[]): [string, PickableItem[]][] {
  const groups = new Map<string, PickableItem[]>();
  for (const item of items) {
    const kind = item.subcategory?.trim() || "other";
    groups.set(kind, [...(groups.get(kind) ?? []), item]);
  }
  return [...groups.entries()].sort(([a], [b]) => a.localeCompare(b));
}

export function OutfitBuilder({
  itemsBySlot,
  allTags,
  action,
  initialItemIds = [],
  initialName = "",
  initialTags = [],
  submitLabel = "Save outfit",
}: {
  itemsBySlot: Record<string, PickableItem[]>;
  allTags: string[];
  action: (prev: OutfitResult | null, formData: FormData) => Promise<OutfitResult>;
  initialItemIds?: readonly string[];
  initialName?: string;
  initialTags?: string[];
  submitLabel?: string;
}) {
  const [result, formAction, pending] = useActionState(action, null);

  /**
   * A slot holds a list, not a single piece.
   *
   * Layering is the normal case, not an exception: a tee under a sweater, a cardigan
   * under a coat, two necklaces. One-item slots forced a choice the wardrobe doesn't —
   * and the data model never needed it, since `OutfitItem` has always carried a slot
   * and an order rather than a slot being unique.
   */
  const [chosen, setChosen] = useState<Partial<Record<Slot, PickableItem[]>>>(() => {
    // Editing starts from what the outfit already contains, preserving its order.
    const start: Partial<Record<Slot, PickableItem[]>> = {};
    for (const [slot, options] of Object.entries(itemsBySlot)) {
      const matches = options.filter((item) => initialItemIds.includes(item.id));
      if (matches.length > 0) start[slot as Slot] = matches;
    }
    return start;
  });

  // Flattened in slot order, head to toe, which is the order they are saved in.
  const selected = useMemo(
    () => BUILDER_SLOTS.flatMap(({ slot }) => chosen[slot] ?? []),
    [chosen],
  );

  const suggestions = useMemo(() => suggestOutfitNames(selected), [selected]);

  /**
   * The name follows the selection until the user takes it over.
   *
   * Tracked with a flag rather than by comparing against the current suggestion: once
   * someone has typed their own name, changing a piece must not overwrite it, and a
   * name that merely happens to match a suggestion shouldn't be treated as untouched.
   * Clearing the field hands control back.
   */
  const [name, setName] = useState(initialName);
  const [edited, setEdited] = useState(initialName.length > 0);
  const value = edited ? name : (suggestions[0] ?? "");

  const toggle = (slot: Slot, item: PickableItem) =>
    setChosen((current) => {
      const picked = current[slot] ?? [];
      const already = picked.some((chosenItem) => chosenItem.id === item.id);
      return {
        ...current,
        // Tapping a chosen piece again removes it, so the same control adds and
        // removes. Newly picked pieces go on the end, and that order is the layering
        // order: last picked is worn outermost.
        [slot]: already
          ? picked.filter((chosenItem) => chosenItem.id !== item.id)
          : [...picked, item],
      };
    });

  return (
    <form action={formAction} className="grid gap-10 lg:grid-cols-[360px_1fr]">
      <div className="lg:sticky lg:top-8 lg:self-start">
        <div className="bg-surface-sunken">
          {selected.length > 0 ? (
            <OutfitFigure items={selected} sizes="360px" />
          ) : (
            <div className="label flex aspect-[2/3] items-center justify-center text-ink-subtle">
              Pick something to start
            </div>
          )}
        </div>

        <p className="mt-3 text-meta text-ink-subtle">
          {selected.length === 0
            ? "Nothing chosen yet"
            : `${selected.length} ${selected.length === 1 ? "piece" : "pieces"}`}
        </p>

        {selected.map((item) => (
          <input key={item.id} type="hidden" name="itemIds" value={item.id} />
        ))}
      </div>

      <div className="grid gap-8">
        {BUILDER_SLOTS.map(({ slot, label }) => {
          const options = itemsBySlot[slot] ?? [];
          if (options.length === 0) return null;

          return (
            <section key={slot}>
              <div className="flex items-baseline justify-between border-b border-line pb-2">
                <p className="label text-ink">{label}</p>
                <p className="truncate pl-4 text-meta text-ink-subtle">
                  {chosen[slot]?.length
                    ? chosen[slot].map((item) => item.name).join(" + ")
                    : `${options.length} to choose from`}
                </p>
              </div>

              {groupBySubcategory(options).map(([kind, group]) => (
                <div key={kind} className="mt-3">
                  {/* A row per kind: one strip of thirty-eight tops isn't scannable
                      however it's sorted, but a strip of six sweaters is. */}
                  <p className="text-meta text-ink-subtle">{kind}</p>
                  <ul className="-mx-6 mt-1 flex gap-3 overflow-x-auto px-6 pb-2">
                    {group.map((item) => {
                      const picked = chosen[slot] ?? [];
                      const position = picked.findIndex((chosenItem) => chosenItem.id === item.id);
                      const active = position >= 0;
                      return (
                        <li key={item.id} className="shrink-0">
                          <button
                            type="button"
                            onClick={() => toggle(slot, item)}
                            aria-pressed={active}
                            title={item.name}
                            className={`relative block size-24 overflow-hidden border transition-colors ${
                              active
                                ? "border-ink bg-surface"
                                : "border-line bg-surface-sunken hover:border-line-strong"
                            }`}
                          >
                            {item.imageUrl && (
                              <Image
                                src={item.imageUrl}
                                alt={item.name}
                                fill
                                unoptimized
                                sizes="96px"
                                className="object-contain"
                              />
                            )}
                            {/* Which layer it is, shown only once a slot holds more
                                than one — otherwise it is noise on every tile. */}
                            {active && picked.length > 1 && (
                              <span className="label absolute right-0 top-0 bg-ink px-1.5 py-0.5 text-canvas">
                                {position + 1}
                              </span>
                            )}
                          </button>
                        </li>
                      );
                    })}
                  </ul>
                </div>
              ))}
            </section>
          );
        })}

        <section className="border-t border-line pt-6">
          <label htmlFor="name" className="label text-ink-subtle">
            Name
          </label>
          <p className="mb-2 mt-1 text-meta text-ink-subtle">
            Named from the pieces as you pick them. Type over it if you&rsquo;d rather
            call it something else.
          </p>
          <input
            id="name"
            name="name"
            value={value}
            onChange={(event) => {
              setName(event.target.value);
              // An emptied field goes back to following the selection.
              setEdited(event.target.value.trim().length > 0);
            }}
            placeholder={suggestions[0] ?? "Monday work"}
            className="w-full border border-line-strong bg-surface px-4 py-3 text-ink placeholder:text-ink-subtle focus:border-ink focus:outline-none"
          />

          <div className="mt-6">
            <p className="label text-ink-subtle">Tags</p>
            <p className="mb-2 mt-1 text-meta text-ink-subtle">
              The same tags label items, so an outfit shows which occasions it belongs to.
            </p>
            <ChipListInput
              name="tags"
              label="Add a tag"
              placeholder="Work, date night…"
              defaultValue={initialTags}
              suggestions={allTags}
            />
          </div>
        </section>

        {result?.ok === false && (
          <p role="alert" className="border-l-2 border-signal-danger bg-surface-sunken py-3 pl-4 text-ink">
            {result.message}
            {result.duplicateOf && (
              <span className="mt-1 block text-meta text-ink-muted">
                Already saved as &ldquo;{result.duplicateOf}&rdquo;.
              </span>
            )}
          </p>
        )}

        <div className="flex items-center gap-6 border-t border-line pt-6">
          <button
            type="submit"
            disabled={pending || selected.length === 0}
            className="label bg-ink px-8 py-3 text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
          >
            {pending ? "Saving…" : submitLabel}
          </button>
          {selected.length === 0 && (
            <span className="text-meta text-ink-subtle">Pick at least one piece.</span>
          )}
        </div>
      </div>
    </form>
  );
}
