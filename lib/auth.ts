import { redirect } from "next/navigation";
import { cache } from "react";

import { db } from "@/lib/db";
import { createClient } from "@/lib/supabase/server";

/**
 * The authenticated Supabase user, or null.
 *
 * Wrapped in `cache` so multiple calls within one request hit the auth server once —
 * the layout, the page, and any Server Action all typically need it.
 */
export const getAuthUser = cache(async () => {
  const supabase = await createClient();
  const {
    data: { user },
  } = await supabase.auth.getUser();
  return user;
});

/**
 * The current user's row in our own database, creating it on first sign-in.
 *
 * Supabase owns `auth.users`; our `users` table is a separate row keyed by the same UUID,
 * holding app-level data auth doesn't know about (the neglected-day threshold, and
 * ownership of every item, outfit, and wear log). Upserting here means there is no
 * separate registration step and no webhook to keep in sync.
 */
export const getCurrentUser = cache(async () => {
  const authUser = await getAuthUser();
  if (!authUser?.email) return null;

  return db.user.upsert({
    where: { id: authUser.id },
    update: {},
    create: { id: authUser.id, email: authUser.email },
  });
});

/**
 * Same, but redirects to login when there is no session.
 *
 * The proxy already guards these routes; this is the second line of defense, so a route
 * that slips past the matcher fails closed rather than rendering with no user.
 */
export async function requireUser() {
  const user = await getCurrentUser();
  if (!user) redirect("/login");
  return user;
}
