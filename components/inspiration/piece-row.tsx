"use client";

import Image from "next/image";
import Link from "next/link";
import { useRouter } from "next/navigation";
import { useTransition } from "react";

import { markPieceBought, setPieceMatch } from "@/app/(app)/inspiration/actions";

export type PieceView = {
  id: string;
  description: string;
  categoryLabel: string;
  match: "MISSING" | "CLOSE" | "OWNED";
  matchedItemId: string | null;
  matchedItemName: string | null;
  /** The matched garment, so a claim that you own something can be checked by eye. */
  matchedItemUrl: string | null;
  bought: boolean;
};

const VERDICTS = [
  { value: "OWNED", label: "Have it" },
  { value: "CLOSE", label: "Close enough" },
  { value: "MISSING", label: "Need it" },
] as const;

/**
 * One garment read out of an inspiration, and what the app thinks of it.
 *
 * Every verdict is correctable, and that is not a nicety: a wrong automatic match
 * removes something from the shopping list without saying so, which is the one failure
 * that makes the list untrustworthy. Correcting also pins the piece, so re-reading the
 * inspiration later leaves the decision alone.
 */
export function PieceRow({ piece }: { piece: PieceView }) {
  const router = useRouter();
  const [pending, start] = useTransition();

  const choose = (value: (typeof VERDICTS)[number]["value"]) =>
    start(async () => {
      await setPieceMatch(piece.id, value, piece.matchedItemId);
      router.refresh();
    });

  return (
    <li className="border-b border-line py-3">
      <div className="flex flex-wrap items-center justify-between gap-x-6 gap-y-2">
        <div className="flex min-w-0 items-center gap-3">
          {/* The matched garment, shown rather than named. "You have this" is a claim
              the user can only check by looking at it. */}
          {piece.matchedItemId && (
            <Link
              href={`/catalog/${piece.matchedItemId}`}
              className="relative size-14 shrink-0 bg-surface-sunken transition-opacity hover:opacity-80"
            >
              {piece.matchedItemUrl && (
                <Image
                  src={piece.matchedItemUrl}
                  alt={piece.matchedItemName ?? ""}
                  fill
                  unoptimized
                  sizes="56px"
                  className="object-contain"
                />
              )}
            </Link>
          )}

          <div className="min-w-0">
            <p className={`text-ink ${piece.bought ? "line-through opacity-60" : ""}`}>
              {piece.description}
            </p>
            <p className="truncate text-meta text-ink-subtle">
              {piece.categoryLabel}
              {piece.matchedItemName && ` · ${piece.matchedItemName}`}
            </p>
          </div>
        </div>

        <div className="flex items-center gap-2">
          {VERDICTS.map((verdict) => (
            <button
              key={verdict.value}
              type="button"
              disabled={pending}
              onClick={() => choose(verdict.value)}
              aria-pressed={piece.match === verdict.value}
              className={`label border px-3 py-1.5 transition-colors disabled:opacity-50 ${
                piece.match === verdict.value
                  ? "border-ink text-ink"
                  : "border-line text-ink-subtle hover:border-line-strong hover:text-ink"
              }`}
            >
              {verdict.label}
            </button>
          ))}

          {piece.match === "MISSING" && (
            <button
              type="button"
              disabled={pending}
              onClick={() =>
                start(async () => {
                  await markPieceBought(piece.id, !piece.bought);
                  router.refresh();
                })
              }
              className="label text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
            >
              {piece.bought ? "Not bought" : "Bought"}
            </button>
          )}
        </div>
      </div>
    </li>
  );
}
