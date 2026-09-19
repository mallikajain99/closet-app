import type { ProcessingStatus } from "@prisma/client";

/**
 * How each pipeline state is surfaced in the catalog.
 *
 * Only the states the user can act on get a badge. DONE is the norm and needs no label,
 * and OVERRIDDEN is the user's own decision — flagging it would read as a defect rather
 * than a preference. Failures are amber, not red: nothing is lost, the item simply shows
 * its source photo until the cutout is retried.
 */
export const PROCESSING_BADGE: Partial<
  Record<ProcessingStatus, { label: string; className: string }>
> = {
  PENDING: {
    label: "Processing",
    className: "bg-surface/90 text-ink-muted",
  },
  PROCESSING: {
    label: "Processing",
    className: "bg-surface/90 text-ink-muted",
  },
  FAILED: {
    label: "Original",
    className: "bg-signal-neglected-soft text-signal-neglected",
  },
};

/** Whether the pipeline is still expected to produce a render for this item. */
export function isProcessing(status: ProcessingStatus) {
  return status === "PENDING" || status === "PROCESSING";
}
