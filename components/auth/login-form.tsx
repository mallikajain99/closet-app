"use client";

import { useState } from "react";

import { createClient } from "@/lib/supabase/client";

type Status =
  | { state: "idle" }
  | { state: "sending" }
  | { state: "sent"; email: string }
  | { state: "error"; message: string };

export function LoginForm({ next }: { next: string }) {
  const [email, setEmail] = useState("");
  const [status, setStatus] = useState<Status>({ state: "idle" });

  async function handleSubmit(event: React.FormEvent<HTMLFormElement>) {
    event.preventDefault();
    setStatus({ state: "sending" });

    const supabase = createClient();
    const { error } = await supabase.auth.signInWithOtp({
      email,
      options: {
        // Built from the live origin so the same code works on localhost and on the
        // deployed URL without a build-time environment variable.
        emailRedirectTo: `${window.location.origin}/auth/callback?next=${encodeURIComponent(next)}`,
      },
    });

    setStatus(
      error ? { state: "error", message: error.message } : { state: "sent", email },
    );
  }

  if (status.state === "sent") {
    return (
      <div className="mt-8 border-t border-line pt-6">
        <p className="text-ink">Check your email.</p>
        <p className="mt-2 text-meta text-ink-muted">
          A sign-in link is on its way to {status.email}. It expires in an hour.
        </p>
        <button
          type="button"
          onClick={() => setStatus({ state: "idle" })}
          className="label mt-6 text-ink-subtle underline underline-offset-4 hover:text-ink"
        >
          Use a different address
        </button>
      </div>
    );
  }

  return (
    <form onSubmit={handleSubmit} className="mt-8 border-t border-line pt-6">
      <label htmlFor="email" className="label block text-ink-subtle">
        Email
      </label>
      <input
        id="email"
        type="email"
        required
        autoFocus
        autoComplete="email"
        value={email}
        onChange={(event) => setEmail(event.target.value)}
        className="mt-2 w-full border-b border-line-strong bg-transparent pb-2 text-ink outline-none placeholder:text-ink-subtle focus:border-ink"
        placeholder="you@example.com"
      />

      {status.state === "error" && (
        <p className="mt-3 text-meta text-signal-danger">{status.message}</p>
      )}

      <button
        type="submit"
        disabled={status.state === "sending"}
        className="label mt-8 w-full bg-ink py-3 text-canvas transition-opacity hover:opacity-90 disabled:opacity-50"
      >
        {status.state === "sending" ? "Sending…" : "Send link"}
      </button>
    </form>
  );
}
