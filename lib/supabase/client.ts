import { createBrowserClient } from "@supabase/ssr";

/** Supabase client for Client Components. Uses the anon key, which is safe in the browser. */
export function createClient() {
  return createBrowserClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY!,
  );
}
