"use client";

import { useState } from "react";

import { Input } from "@/components/ui/field";

/**
 * Tag picker over one shared vocabulary (spec §1) — the same tags label outfits, so
 * existing tags are offered before new ones are invented and the two sides stay aligned.
 */
export function TagInput({
  defaultValue,
  suggestions,
}: {
  defaultValue: string[];
  suggestions: string[];
}) {
  const [tags, setTags] = useState<string[]>(defaultValue);
  const [draft, setDraft] = useState("");

  function add(raw: string) {
    const name = raw.trim();
    if (!name) return;
    // Case-insensitive dedupe: "Work" and "work" should not become two tags.
    if (tags.some((tag) => tag.toLowerCase() === name.toLowerCase())) {
      setDraft("");
      return;
    }
    setTags([...tags, name]);
    setDraft("");
  }

  const unused = suggestions.filter(
    (suggestion) => !tags.some((tag) => tag.toLowerCase() === suggestion.toLowerCase()),
  );

  return (
    <div>
      {tags.map((tag) => (
        <input key={tag} type="hidden" name="tags" value={tag} />
      ))}

      {tags.length > 0 && (
        <ul className="mb-4 flex flex-wrap gap-2">
          {tags.map((tag) => (
            <li key={tag}>
              <button
                type="button"
                onClick={() => setTags(tags.filter((t) => t !== tag))}
                className="label border border-ink bg-ink px-3 py-1.5 text-canvas"
                aria-label={`Remove ${tag}`}
              >
                {tag} <span aria-hidden="true">×</span>
              </button>
            </li>
          ))}
        </ul>
      )}

      <Input
        value={draft}
        onChange={(event) => setDraft(event.target.value)}
        onKeyDown={(event) => {
          // Enter adds a tag rather than submitting the whole form, which would be a
          // surprising way to lose a half-filled item.
          if (event.key === "Enter" || event.key === ",") {
            event.preventDefault();
            add(draft);
          }
        }}
        onBlur={() => add(draft)}
        placeholder="Work, date night, gym…"
        aria-label="Add a tag"
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
