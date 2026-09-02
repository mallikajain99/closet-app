"use client";

import { useState } from "react";

import { Input } from "@/components/ui/field";
import { normalizeWhitespace } from "@/lib/text";

/**
 * Repeatable value input rendered as removable chips, with suggestions.
 *
 * Used for tags and for silhouette. Suggestions come from what the user has already
 * used, so the vocabulary converges instead of fragmenting into near-duplicates — the
 * same reason free-text fields get canonicalised on save.
 */
export function ChipListInput({
  name,
  defaultValue,
  suggestions,
  placeholder,
  label,
}: {
  name: string;
  defaultValue: string[];
  suggestions: string[];
  placeholder?: string;
  label: string;
}) {
  const [values, setValues] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const value = normalizeWhitespace(raw);
    setDraft("");
    if (!value) return;

    // Case-insensitive dedupe, and reuse the existing spelling when there is one, so
    // "Work" and "work" can't both end up in the list.
    const existing = [...values, ...suggestions].find(
      (candidate) => candidate.toLowerCase() === value.toLowerCase(),
    );
    const canonical = existing ?? value;

    if (values.some((v) => v.toLowerCase() === canonical.toLowerCase())) return;
    setValues([...values, canonical]);
  }

  const unused = suggestions.filter(
    (suggestion) => !values.some((v) => v.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <div>
      {values.map((value) => (
        <input key={value} type="hidden" name={name} value={value} />
      ))}

      {values.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2">
          {values.map((value) => (
            <li key={value}>
              <button
                type="button"
                onClick={() => setValues(values.filter((v) => v !== value))}
                className="label border border-ink bg-ink px-3 py-1.5 text-canvas"
                aria-label={`Remove ${value}`}
              >
                {value} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter adds a value rather than submitting the form, which would be a
          // surprising way to lose a half-filled item.
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
        placeholder={placeholder}
        aria-label={label}
      />

      {unused.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-2">
          {unused.map((suggestion) => (
            <li key={suggestion}>
              <button
                type="button"
                onClick={() => add(suggestion)}
                className="label border border-line-strong px-3 py-1.5 text-ink-muted transition-colors hover:border-ink hover:text-ink"
              >
                + {suggestion}
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
