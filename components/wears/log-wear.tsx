"use client";

import { useRouter } from "next/navigation";
import { useActionState, useState, useTransition } from "react";

import type { WearResult } from "@/app/(app)/wears/actions";

export type RecentWear = { id: string; wornOn: string; label: string };

/**
 * Log a wear from the item page — today with one tap, or backdated.
 *
 * Backdating is deliberately not hidden behind a disclosure: the spec makes it a
 * first-class action because occasion pieces get worn and only remembered later, and
 * that is exactly what rescues them from the neglected list.
 */
export function LogWear({
  today,
  recent,
  action,
  remove,
}: {
  today: string;
  recent: RecentWear[];
  action: (prev: WearResult | null, formData: FormData) => Promise<WearResult>;
  remove: (wearLogId: string) => Promise<WearResult>;
}) {
  const router = useRouter();
  const [result, formAction, pending] = useActionState(action, null);
  const [removing, startRemoving] = useTransition();
  const [wornOn, setWornOn] = useState(today);

  /**
   * Reset the picker after a successful log, so the next tap means "today" rather than
   * silently repeating whatever date was just filed.
   *
   * Adjusted during render against the last result seen, not in an effect: an effect
   * would paint the stale date for a frame, and resetting on every render would fight
   * the user while they are still choosing a date.
   */
  const [seen, setSeen] = useState(result);
  if (result !== seen) {
    setSeen(result);
    if (result?.ok) setWornOn(today);
  }

  return (
    <div className="mt-8 border-t border-line pt-6">
      <p className="label text-ink-subtle">Wear log</p>

      <form action={formAction} className="mt-3 flex flex-wrap items-center gap-3">
        <input
          type="date"
          name="wornOn"
          value={wornOn}
          max={today}
          onChange={(event) => setWornOn(event.target.value)}
          aria-label="Date worn"
          className="border border-line-strong bg-surface px-3 py-2 text-meta text-ink focus:border-ink focus:outline-none"
        />
        <button
          type="submit"
          disabled={pending}
          className="label bg-ink px-5 py-2.5 text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
        >
          {pending ? "Logging…" : wornOn === today ? "Worn today" : "Add this wear"}
        </button>
      </form>

      {result?.ok === false && (
        <p role="alert" className="mt-2 text-meta text-signal-danger">
          {result.fieldErrors?.wornOn?.[0] ?? result.message}
        </p>
      )}

      {recent.length > 0 && (
        <ul className="mt-4 grid gap-1">
          {recent.map((wear) => (
            <li key={wear.id} className="flex items-center gap-3 text-meta text-ink-muted">
              <span className="tabular-nums">{wear.label}</span>
              <button
                type="button"
                disabled={removing}
                onClick={() =>
                  startRemoving(async () => {
                    await remove(wear.id);
                    router.refresh();
                  })
                }
                className="label text-ink-subtle underline underline-offset-4 transition-colors hover:text-signal-danger disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
