"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { createInspiration, requestInspirationUpload } from "@/app/(app)/inspiration/actions";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  ORIGINALS_BUCKET,
} from "@/lib/images/storage.client";
import { createClient } from "@/lib/supabase/client";

/**
 * Save an outfit you saw somewhere.
 *
 * Upload goes browser-to-storage, as everywhere else here, because a screenshot from a
 * phone routinely exceeds the request body limit a Server Action is bound by. Only the
 * key crosses the server boundary.
 */
export function InspirationForm() {
  const inputRef = useRef<HTMLInputElement>(null);
  const [imageKey, setImageKey] = useState("");
  const [preview, setPreview] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setError(
        `That image is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      );
      return;
    }

    setError(null);
    setPreview(URL.createObjectURL(file));
    setUploading(true);

    try {
      const { key, token } = await requestInspirationUpload(file.name);
      const supabase = createClient();
      const { error: uploadError } = await supabase.storage
        .from(ORIGINALS_BUCKET)
        .uploadToSignedUrl(key, token, file);
      if (uploadError) throw uploadError;
      setImageKey(key);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
    }
  }

  return (
    <form action={createInspiration} className="mt-10 grid max-w-xl gap-6">
      <input type="hidden" name="imageKey" value={imageKey} />

      <div>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="relative flex aspect-[3/4] w-full max-w-64 items-center justify-center overflow-hidden border border-dashed border-line-strong bg-surface-sunken transition-colors hover:border-ink"
        >
          {preview ? (
            <Image src={preview} alt="" fill unoptimized sizes="256px" className="object-cover" />
          ) : (
            <span className="label text-ink-subtle">Choose an image</span>
          )}
        </button>
        <input
          ref={inputRef}
          type="file"
          accept={ACCEPTED_IMAGE_TYPES.join(",")}
          onChange={handleFile}
          className="hidden"
        />
        {uploading && <p className="mt-2 text-meta text-ink-subtle">Uploading…</p>}
        {error && (
          <p role="alert" className="mt-2 text-meta text-signal-danger">
            {error}
          </p>
        )}
      </div>

      <div>
        <label htmlFor="note" className="label text-ink-subtle">
          What to call it
        </label>
        <input
          id="note"
          name="note"
          placeholder="Autumn layering, wedding guest…"
          className="mt-1 w-full border border-line-strong bg-surface px-3 py-2 text-meta text-ink focus:border-ink focus:outline-none"
        />
      </div>

      <div>
        <label htmlFor="sourceUrl" className="label text-ink-subtle">
          Where it came from (optional)
        </label>
        <input
          id="sourceUrl"
          name="sourceUrl"
          type="url"
          placeholder="https://…"
          className="mt-1 w-full border border-line-strong bg-surface px-3 py-2 text-meta text-ink focus:border-ink focus:outline-none"
        />
      </div>

      <div className="border-t border-line pt-6">
        <button
          type="submit"
          disabled={!imageKey || uploading}
          className="label bg-ink px-8 py-3 text-canvas transition-opacity hover:opacity-90 disabled:opacity-40"
        >
          Save and read it
        </button>
        <p className="mt-2 text-meta text-ink-subtle">
          Reading the garments takes a moment; the page will fill in.
        </p>
      </div>
    </form>
  );
}
