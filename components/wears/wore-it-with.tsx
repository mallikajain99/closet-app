"use client";

import Image from "next/image";
import { useState } from "react";

export type SwappablePiece = { id: string; name: string; imageUrl: string | null };

/**
 * Record what was actually worn, when it differed from the saved outfit.
 *
 * The alternative was making the user save a near-duplicate outfit every time she
 * threw a coat on or changed her shoes — which multiplies the outfit list, splits the
 * wear history of what is obviously one look, and fills suggestions with variations of
 * the same thing. The outfit is the idea; the wear is the fact, and `WearLog` has
 * always carried its own item list, so recording the difference costs no new tables.
 *
 * It matters beyond tidiness: these rows are what item stats read. A coat added here
 * gets a real wear and its own last-worn date, rather than being invisible to the
 * closet because it never belonged to a saved outfit.
 */
export function WoreItWith({
  pieces,
  extras,
  suggested,
}: {
  /** The outfit's own pieces, each of which can be dropped for this day. */
  pieces: SwappablePiece[];
  /** Everything else in the closet, to add for this day. */
  extras: SwappablePiece[];
  /** What she usually throws over an outfit, learned from her own logs. */
  suggested: SwappablePiece[];
}) {
  const [open, setOpen] = useState(false);
  const [dropped, setDropped] = useState<string[]>([]);
  const [added, setAdded] = useState<string[]>([]);
  const [search, setSearch] = useState("");

  const changes = dropped.length + added.length;

  const matches = search.trim()
    ? extras
        .filter((item) => item.name.toLowerCase().includes(search.trim().toLowerCase()))
        .slice(0, 8)
    : [];

  return (
    <div className="mt-3">
      {/* The values the action reads. Kept outside the collapsed panel so a change
          made and then hidden is still submitted. */}
      {dropped.map((id) => (
        <input key={id} type="hidden" name="didNotWear" value={id} />
      ))}
      {added.map((id) => (
        <input key={id} type="hidden" name="alsoWore" value={id} />
      ))}

      <button
        type="button"
        onClick={() => setOpen(!open)}
        className="label text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink"
      >
        {/* Names both directions. "Wore it with something different?" reads as a
            prompt to add, and the ability to leave a piece out — the hat you own but
            are not wearing today — went unfound behind it. */}
        {changes > 0
          ? `Wore it with changes (${changes})`
          : pieces.length > 0
            ? "Add or leave out a piece?"
            : "Wore it with something different?"}
      </button>

      {open && (
        <div className="mt-3 border-l-2 border-line pl-4">
          <p className="text-meta leading-relaxed text-ink-muted">
            Changes apply to this day only. The outfit itself stays as it is.
          </p>

          {pieces.length > 0 && (
            <>
              <p className="label mt-3 text-ink-subtle">Leave out</p>
              {/* Pictures, like the "Also wore" tiles below. These were name-only
                  chips, which is the wrong way round: adding a garment starts from a
                  name you are searching for, while leaving one out starts from a thing
                  you can see on the figure above. Matching the two also means the panel
                  reads as one control with two directions rather than two controls. */}
              <ul className="mt-2 flex flex-wrap gap-2">
                {pieces.map((piece) => {
                  const off = dropped.includes(piece.id);
                  return (
                    <li key={piece.id}>
                      <button
                        type="button"
                        onClick={() =>
                          setDropped(
                            off
                              ? dropped.filter((id) => id !== piece.id)
                              : [...dropped, piece.id],
                          )
                        }
                        aria-pressed={off}
                        title={
                          off ? `${piece.name} — left out` : `Leave out ${piece.name}`
                        }
                        className={`flex w-20 flex-col items-center gap-1 border p-1 transition-colors ${
                          off
                            ? "border-line opacity-45"
                            : "border-line hover:border-line-strong"
                        }`}
                      >
                        <span className="relative h-16 w-full bg-surface-sunken">
                          {piece.imageUrl && (
                            <Image
                              src={piece.imageUrl}
                              alt=""
                              fill
                              unoptimized
                              sizes="80px"
                              className="object-contain"
                            />
                          )}
                          {/* A struck-through thumbnail, so the state survives being
                              read at a glance: opacity alone is ambiguous next to a
                              garment that is simply pale. */}
                          {off && (
                            <span
                              aria-hidden="true"
                              className="absolute inset-0 flex items-center justify-center"
                            >
                              <span className="h-px w-[86%] rotate-[-20deg] bg-ink" />
                            </span>
                          )}
                        </span>
                        <span
                          className={`w-full truncate text-center text-meta ${
                            off ? "text-ink-subtle line-through" : "text-ink-muted"
                          }`}
                        >
                          {piece.name}
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            </>
          )}

          <p className="label mt-4 text-ink-subtle">Also wore</p>

          {/* Offered before the search box, because the answer is usually one of
              these: the same coat goes over most things, and typing its name every
              time is the friction that stops a log being kept. Learned from what she
              has actually added before, not assumed. */}
          {suggested.length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {suggested.map((item) => {
                const on = added.includes(item.id);
                return (
                  <li key={item.id}>
                    <button
                      type="button"
                      onClick={() =>
                        setAdded(
                          on
                            ? added.filter((other) => other !== item.id)
                            : [...added, item.id],
                        )
                      }
                      aria-pressed={on}
                      title={item.name}
                      className={`flex w-20 flex-col items-center gap-1 border p-1 transition-colors ${
                        on
                          ? "border-ink bg-surface"
                          : "border-line hover:border-line-strong"
                      }`}
                    >
                      <span className="relative h-16 w-full bg-surface-sunken">
                        {item.imageUrl && (
                          <Image
                            src={item.imageUrl}
                            alt=""
                            fill
                            unoptimized
                            sizes="80px"
                            className="object-contain"
                          />
                        )}
                      </span>
                      <span className="w-full truncate text-center text-meta text-ink-muted">
                        {item.name}
                      </span>
                    </button>
                  </li>
                );
              })}
            </ul>
          )}

          {/* Anything added that wasn't one of the suggestions, so it can be removed. */}
          {added.filter((id) => !suggested.some((item) => item.id === id)).length > 0 && (
            <ul className="mt-2 flex flex-wrap gap-2">
              {added
                .filter((id) => !suggested.some((item) => item.id === id))
                .map((id) => {
                  const item = extras.find((candidate) => candidate.id === id);
                  return (
                    <li key={id}>
                      <button
                        type="button"
                        onClick={() => setAdded(added.filter((other) => other !== id))}
                        className="label border border-ink px-3 py-1.5 text-ink"
                      >
                        {item?.name ?? "Item"} <span aria-hidden="true">×</span>
                      </button>
                    </li>
                  );
                })}
            </ul>
          )}

          <input
            type="search"
            value={search}
            onChange={(event) => setSearch(event.target.value)}
            placeholder="Or search your closet…"
            aria-label="Find something else you wore"
            className="mt-2 w-full border border-line-strong bg-surface px-3 py-2 text-meta text-ink focus:border-ink focus:outline-none"
          />

          {matches.length > 0 && (
            <ul className="mt-2 grid gap-1">
              {matches.map((item) => (
                <li key={item.id}>
                  <button
                    type="button"
                    onClick={() => {
                      if (!added.includes(item.id)) setAdded([...added, item.id]);
                      setSearch("");
                    }}
                    className="flex w-full items-center gap-3 border-b border-line py-2 text-left text-meta text-ink-muted transition-colors hover:text-ink"
                  >
                    <span className="relative size-8 shrink-0 bg-surface-sunken">
                      {item.imageUrl && (
                        <Image
                          src={item.imageUrl}
                          alt=""
                          fill
                          unoptimized
                          sizes="32px"
                          className="object-contain"
                        />
                      )}
                    </span>
                    {item.name}
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </div>
  );
}
