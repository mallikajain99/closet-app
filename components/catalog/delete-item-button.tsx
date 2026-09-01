"use client";

import { useState } from "react";

/**
 * Two-step delete. Deleting an item also removes it from every outfit that contains it
 * and erases its wear history, so a single misplaced tap shouldn't do it.
 */
export function DeleteItemButton({
  itemName,
  action,
}: {
  itemName: string;
  action: () => Promise<void>;
}) {
  const [confirming, setConfirming] = useState(false);

  if (!confirming) {
    return (
      <button
        type="button"
        onClick={() => setConfirming(true)}
        className="label text-ink-subtle transition-colors hover:text-signal-danger"
      >
        Delete
      </button>
    );
  }

  return (
    <form action={action} className="flex items-center gap-4">
      <span className="text-meta text-ink-muted">Delete {itemName}?</span>
      <button type="submit" className="label text-signal-danger underline underline-offset-4">
        Yes, delete
      </button>
      <button
        type="button"
        onClick={() => setConfirming(false)}
        className="label text-ink-subtle hover:text-ink"
      >
        Cancel
      </button>
    </form>
  );
}
