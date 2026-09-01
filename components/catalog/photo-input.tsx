"use client";

import Image from "next/image";
import { useRef, useState } from "react";

import { requestUploadUrl } from "@/app/(app)/catalog/actions";
import {
  ACCEPTED_IMAGE_TYPES,
  MAX_UPLOAD_BYTES,
  ORIGINALS_BUCKET,
} from "@/lib/images/storage.client";
import { createClient } from "@/lib/supabase/client";

type UploadState =
  | { status: "idle" }
  | { status: "uploading" }
  | { status: "done" }
  | { status: "error"; message: string };

export function PhotoInput({
  name = "originalImageKey",
  initialKey,
  initialUrl,
}: {
  name?: string;
  initialKey?: string | null;
  initialUrl?: string | null;
}) {
  const inputRef = useRef<HTMLInputElement>(null);
  const [key, setKey] = useState(initialKey ?? "");
  const [preview, setPreview] = useState<string | null>(initialUrl ?? null);
  const [state, setState] = useState<UploadState>({ status: "idle" });

  async function handleFile(event: React.ChangeEvent<HTMLInputElement>) {
    const file = event.target.files?.[0];
    if (!file) return;

    if (file.size > MAX_UPLOAD_BYTES) {
      setState({
        status: "error",
        message: `That photo is ${(file.size / 1024 / 1024).toFixed(1)} MB. The limit is ${MAX_UPLOAD_BYTES / 1024 / 1024} MB.`,
      });
      return;
    }

    // Show the local file immediately; the upload continues in the background so the
    // user can start filling in details rather than watching a spinner.
    setPreview(URL.createObjectURL(file));
    setState({ status: "uploading" });

    try {
      const { key: uploadKey, token } = await requestUploadUrl(file.name);
      const supabase = createClient();
      const { error } = await supabase.storage
        .from(ORIGINALS_BUCKET)
        .uploadToSignedUrl(uploadKey, token, file);

      if (error) throw error;

      setKey(uploadKey);
      setState({ status: "done" });
    } catch (error) {
      setState({
        status: "error",
        message: error instanceof Error ? error.message : "Upload failed. Try again.",
      });
    }
  }

  return (
    <div>
      <input type="hidden" name={name} value={key} />
      <input
        ref={inputRef}
        type="file"
        accept={ACCEPTED_IMAGE_TYPES.join(",")}
        capture="environment"
        onChange={handleFile}
        className="sr-only"
      />

      <button
        type="button"
        onClick={() => inputRef.current?.click()}
        className="relative flex aspect-[3/4] w-full items-center justify-center overflow-hidden border border-line-strong bg-surface-sunken transition-colors hover:border-ink"
      >
        {preview ? (
          <Image
            src={preview}
            alt=""
            fill
            unoptimized
            className="object-contain"
            sizes="(max-width: 640px) 100vw, 320px"
          />
        ) : (
          <span className="label text-ink-subtle">Add a photo</span>
        )}

        {state.status === "uploading" && (
          <span className="label absolute bottom-0 left-0 right-0 bg-ink/80 py-2 text-canvas">
            Uploading…
          </span>
        )}
      </button>

      {state.status === "error" && (
        <p className="mt-2 text-meta text-signal-danger">{state.message}</p>
      )}

      {preview && state.status !== "uploading" && (
        <button
          type="button"
          onClick={() => inputRef.current?.click()}
          className="label mt-2 text-ink-subtle underline underline-offset-4 hover:text-ink"
        >
          Replace photo
        </button>
      )}

      <p className="mt-4 border-l-2 border-line pl-3 text-meta leading-relaxed text-ink-muted">
        Shoot it on a hanger or dress form rather than flat on a surface. A hung garment
        keeps its shoulders and drape, so it looks like clothing in the outfit view — a
        flat-lay reads as a sticker no matter how it&rsquo;s composited.
      </p>
    </div>
  );
}
