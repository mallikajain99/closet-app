import { redirect } from "next/navigation";

import { createClient } from "@/lib/supabase/server";

export function SignOutButton() {
  async function signOut() {
    "use server";
    const supabase = await createClient();
    await supabase.auth.signOut();
    redirect("/login");
  }

  return (
    <form action={signOut}>
      <button
        type="submit"
        className="label text-ink-subtle transition-colors hover:text-ink"
      >
        Sign out
      </button>
    </form>
  );
}
