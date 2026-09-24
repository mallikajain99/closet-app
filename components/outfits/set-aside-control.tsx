"use client";

import { useRouter } from "next/navigation";
import { useState, useTransition } from "react";

import {
  bringOutfitBack,
  replaceOutfitTags,
  setOutfitAside,
} from "@/app/(app)/outfits/actions";
import { ChipListInput } from "@/components/ui/chip-list-input";
import { SNOOZE_OPTIONS } from "@/lib/outfits/set-aside";

/**
 * "Not right now" for an outfit.
 *
 * Two shapes, because they answer different questions. A snooze is time-boxed and
 * comes back on its own — right for something worn to death lately. Shelving has no
 * end date, which is the honest model for an interview suit: it isn't that you won't
 * wear it for ninety days, it's that you'll wear it when the occasion comes.
 *
 * The tag box is the point of the whole interaction. Setting something aside is the
 * one moment the user actually knows *why*, and the reason is usually a word worth
 * keeping — "interview", "too formal", "summer only". These go into the ordinary tag
 * vocabulary rather than a private reason field, so the same word can later shelve the
 * whole class at once.
 */
export function SetAsideControl({
  outfitId,
  label,
  allTags,
  currentTags,
}: {
  outfitId: string;
  /** "Shelved", "Back in 12 days", or null when the outfit is in rotation. */
  label: string | null;
  allTags: string[];
  currentTags: string[];
}) {
  const router = useRouter();
  const [open, setOpen] = useState(false);
  /**
   * Two transitions, not one.
   *
   * Sharing a single `pending` meant saving a tag disabled the snooze and shelve
   * buttons for as long as the refresh took — so the natural sequence, type "Office"
   * then press Shelve, had the press land on a disabled button and do nothing at all.
   */
  const [savingTags, startTags] = useTransition();
  const [holding, startHold] = useTransition();

  /**
   * Tags save on the chip, not on a submit.
   *
   * The first version carried them along with whichever snooze button was pressed,
   * which meant typing a tag and then closing the panel silently threw it away. This
   * box is the one place tagging happens while thinking about something else, so it
   * has to behave like every other edit here and save itself.
   */
  const saveTags = (next: string[]) =>
    startTags(async () => {
      await replaceOutfitTags(outfitId, next);
      router.refresh();
    });

  const act = (input: { snoozeDays?: number; shelve?: boolean }) =>
    startHold(async () => {
      await setOutfitAside(outfitId, input);
      setOpen(false);
      router.refresh();
    });

  if (label) {
    return (
      <div className="mt-8 flex items-center gap-4 border-t border-line pt-6">
        <p className="label text-ink-subtle">{label}</p>
        <button
          type="button"
          disabled={holding}
          onClick={() =>
            startHold(async () => {
              await bringOutfitBack(outfitId);
              router.refresh();
            })
          }
          className="label text-ink underline underline-offset-4 disabled:opacity-50"
        >
          Put back in rotation
        </button>
      </div>
    );
  }

  return (
    <div className="mt-8 border-t border-line pt-6">
      {!open ? (
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="label text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink"
        >
          Not right now
        </button>
      ) : (
        <div>
          <p className="label text-ink">Set this aside</p>
          <p className="mt-1 text-meta leading-relaxed text-ink-muted">
            It stays in your closet and stops appearing in suggestions or least-worn.
          </p>

          <div className="mt-3">
            <p className="text-meta text-ink-subtle">
              Why? {savingTags ? "Saving…" : "Saves as you add"}
            </p>
            <div className="mt-1">
              <ChipListInput
                name="setAsideTags"
                defaultValue={currentTags}
                label="Add a reason"
                placeholder="Office, interview, too formal…"
                suggestions={allTags}
                onChange={saveTags}
              />
            </div>
          </div>

          <div className="mt-4 flex flex-wrap items-center gap-3">
            {SNOOZE_OPTIONS.map((option) => (
              <button
                key={option.days}
                type="button"
                disabled={holding}
                onClick={() => act({ snoozeDays: option.days })}
                className="label border border-line-strong px-4 py-2 text-ink-muted transition-colors hover:border-ink hover:text-ink disabled:opacity-50"
              >
                {option.label}
              </button>
            ))}
            <button
              type="button"
              disabled={holding}
              onClick={() => act({ shelve: true })}
              className="label bg-ink px-4 py-2 text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
            >
              Shelve indefinitely
            </button>
            <button
              type="button"
              onClick={() => setOpen(false)}
              className="label text-ink-subtle underline underline-offset-4"
            >
              Cancel
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
