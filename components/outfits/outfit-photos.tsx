"use client";

import Image from "next/image";
import { useRouter } from "next/navigation";
import { useRef, useState, useTransition } from "react";

import {
  addOutfitPhoto,
  deleteOutfitPhoto,
  requestOutfitPhotoUpload,
} from "@/app/(app)/outfits/actions";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  ORIGINALS_BUCKET,
} from "@/lib/images/storage.client";
import { createClient } from "@/lib/supabase/client";

export type OutfitPhoto = { id: string; url: string | null };

/**
 * Photos of the outfit on a body.
 *
 * This is the honest answer to the goal the composite only approximates: a photograph
 * of the user in the outfit is exact by construction, where every rendered approach is
 * a guess at drape and fit. Photographing an outfit once covers it forever, and the
 * composite stays as the fallback for the ones never photographed.
 *
 * Uploaded straight to storage from the browser, as item photos are, because a phone
 * photo routinely exceeds the request body limit a Server Action is bound by.
 */
export function OutfitPhotos({
  outfitId,
  photos,
}: {
  outfitId: string;
  photos: OutfitPhoto[];
}) {
  const router = useRouter();
  const inputRef = useRef<HTMLInputElement>(null);
  const [error, setError] = useState<string | null>(null);
  const [uploading, setUploading] = useState(false);
  const [removing, startRemoving] = useTransition();

  async function handleFiles(event: React.ChangeEvent<HTMLInputElement>) {
    const files = [...(event.target.files ?? [])];
    if (files.length === 0) return;

    setError(null);
    setUploading(true);

    try {
      const supabase = createClient();
      for (const file of files) {
        if (file.size > MAX_UPLOAD_BYTES) {
          throw new Error(
            `${file.name} is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
          );
        }

        const { key, token } = await requestOutfitPhotoUpload(file.name);
        const { error: uploadError } = await supabase.storage
          .from(ORIGINALS_BUCKET)
          .uploadToSignedUrl(key, token, file);
        if (uploadError) throw uploadError;

        const result = await addOutfitPhoto(outfitId, key);
        if (!result.ok) throw new Error(result.message ?? "Could not save that photo.");
      }
      router.refresh();
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : "Upload failed. Try again.");
    } finally {
      setUploading(false);
      // Cleared so the same file can be picked again after a failure.
      if (inputRef.current) inputRef.current.value = "";
    }
  }

  return (
    <section className="mt-10 border-t border-line pt-6">
      <div className="flex items-baseline justify-between gap-4">
        <p className="label text-ink-subtle">Worn</p>
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          disabled={uploading}
          className="label text-ink-subtle underline underline-offset-4 transition-colors hover:text-ink disabled:opacity-50"
        >
          {uploading ? "Uploading…" : "Add a photo"}
        </button>
      </div>

      <p className="mt-1 text-meta leading-relaxed text-ink-muted">
        Photos of you in this outfit. Not tied to a date — they are here so the outfit
        can be seen on a body rather than as stacked cutouts.
      </p>

      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        multiple
        onChange={handleFiles}
        className="hidden"
      />

      {error && (
        <p role="alert" className="mt-2 text-meta text-signal-danger">
          {error}
        </p>
      )}

      {photos.length > 0 && (
        <ul className="mt-4 grid grid-cols-3 gap-3 sm:grid-cols-4">
          {photos.map((photo) => (
            <li key={photo.id} className="group relative">
              <div className="relative aspect-[2/3] overflow-hidden bg-surface-sunken">
                {photo.url && (
                  <Image
                    src={photo.url}
                    alt=""
                    fill
                    unoptimized
                    sizes="(max-width: 640px) 33vw, 200px"
                    className="object-cover"
                  />
                )}
              </div>
              <button
                type="button"
                disabled={removing}
                onClick={() =>
                  startRemoving(async () => {
                    await deleteOutfitPhoto(photo.id);
                    router.refresh();
                  })
                }
                className="label absolute right-1 top-1 bg-canvas/90 px-2 py-1 text-ink-subtle opacity-0 transition-opacity hover:text-signal-danger group-hover:opacity-100 disabled:opacity-50"
              >
                Remove
              </button>
            </li>
          ))}
        </ul>
      )}
    </section>
  );
}
