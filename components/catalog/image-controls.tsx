"use client";

import { useRouter } from "next/navigation";
import { useEffect, useState, useTransition } from "react";

import type { ActionResult } from "@/app/(app)/catalog/actions";
import type { ProcessingStatus } from "@prisma/client";

/** How often to re-check an in-flight job. Segmentation takes tens of seconds. */
const POLL_MS = 5000;

type Props = {
  status: ProcessingStatus;
  hasPhoto: boolean;
  /** Why the last run failed, from the item's job row. */
  error: string | null;
  reprocess: () => Promise<ActionResult>;
  keepOriginal: () => Promise<ActionResult>;
};

/**
 * Processing state and the two manual overrides: run the cutout again, or reject it and
 * keep the photo as shot.
 *
 * While a job is in flight the page refreshes itself, because the work happens in an
 * `after()` callback on a different request — nothing will revalidate this page when it
 * lands. Polling stops as soon as the status settles.
 */
export function ImageControls({
  status,
  hasPhoto,
  error,
  reprocess,
  keepOriginal,
}: Props) {
  const router = useRouter();
  const [pending, startTransition] = useTransition();
  const [message, setMessage] = useState<string | null>(null);

  const running = status === "PENDING" || status === "PROCESSING";

  useEffect(() => {
    if (!running) return;
    const timer = setInterval(() => router.refresh(), POLL_MS);
    return () => clearInterval(timer);
  }, [running, router]);

  if (!hasPhoto) return null;

  const run = (action: () => Promise<ActionResult>) => {
    setMessage(null);
    startTransition(async () => {
      const result = await action();
      if (!result.ok) setMessage(result.message);
      else router.refresh();
    });
  };

  return (
    <div className="mt-6 border-t border-line pt-4">
      {running && (
        <p className="text-meta text-ink-muted">
          Removing the background… this usually takes under a minute. The original is
          shown until it&rsquo;s done.
        </p>
      )}

      {status === "FAILED" && (
        <div className="text-meta">
          <p className="text-signal-neglected">
            Couldn&rsquo;t cut this one out — showing the original photo.
          </p>
          {error && <p className="mt-1 text-ink-subtle">{error}</p>}
        </div>
      )}

      {status === "OVERRIDDEN" && (
        <p className="text-meta text-ink-muted">
          Using the original photo by your choice.
        </p>
      )}

      {!running && (
        <div className="mt-3 flex items-center gap-6">
          <button
            type="button"
            disabled={pending}
            onClick={() => run(reprocess)}
            className="label text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
          >
            {pending ? "Working…" : status === "DONE" ? "Redo cutout" : "Try again"}
          </button>

          {status !== "OVERRIDDEN" && (
            <button
              type="button"
              disabled={pending}
              onClick={() => run(keepOriginal)}
              className="label text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
            >
              Keep original photo
            </button>
          )}
        </div>
      )}

      {message && <p className="mt-3 text-meta text-signal-danger">{message}</p>}
    </div>
  );
}
