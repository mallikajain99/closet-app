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

  const [chosen, setChosen] = useState<Partial<Record<Slot, PickableItem>>>(() => {
    // Editing starts from what the outfit already contains.
    const start: Partial<Record<Slot, PickableItem>> = {};
    for (const [slot, options] of Object.entries(itemsBySlot)) {
      const match = options.find((item) => initialItemIds.includes(item.id));
      if (match) start[slot as Slot] = match;
    }
    return start;
  });

  const selected = useMemo(
    () => Object.values(chosen).filter(Boolean) as PickableItem[],
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
    setChosen((current) => ({
      ...current,
      // Tapping the chosen item again clears the slot, so a piece can be removed with
      // the same control that added it.
      [slot]: current[slot]?.id === item.id ? undefined : item,
    }));

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
              <div className="flex items-baseline justify-between">
                <p className="label text-ink-subtle">{label}</p>
                <p className="text-meta text-ink-subtle">
                  {chosen[slot]?.name ?? `${options.length} to choose from`}
                </p>
              </div>

              <ul className="-mx-6 mt-2 flex gap-3 overflow-x-auto px-6 pb-2">
                {options.map((item) => {
                  const active = chosen[slot]?.id === item.id;
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
                      </button>
                    </li>
                  );
                })}
              </ul>
            </section>
          );
        })}

        <section className="border-t border-line pt-6">
          <label htmlFor="name" className="label text-ink-subtle">
            Name <span className="text-ink-subtle">(optional)</span>
          </label>
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
            className="mt-2 w-full border border-line-strong bg-surface px-4 py-3 text-ink placeholder:text-ink-subtle focus:border-ink focus:outline-none"
          />

          {suggestions.length > 1 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {suggestions.map((suggestion) => (
                <li key={suggestion}>
                  <button
                    type="button"
                    onClick={() => {
                      setName(suggestion);
                      setEdited(true);
                    }}
                    aria-pressed={value === suggestion}
                    className={`label border px-3 py-1.5 transition-colors ${
                      value === suggestion
                        ? "border-ink bg-ink text-canvas"
                        : "border-line-strong text-ink-muted hover:border-ink hover:text-ink"
                    }`}
                  >
                    {suggestion}
                  </button>
                </li>
              ))}
            </ul>
          )}

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
