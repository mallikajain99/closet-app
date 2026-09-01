import { createClient } from "@supabase/supabase-js";

/**
 * Service-role Supabase client. **Server-only** — this key bypasses row-level security.
 *
 * Used for storage operations: minting signed upload URLs and signed read URLs. Going
 * through the service role means the storage buckets need no RLS policies of their own,
 * since every path is authorised by our own code before a URL is ever issued.
 */
export function createAdminClient() {
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;

  if (!url || !serviceKey) {
    throw new Error(
      "NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set — see SETUP.md.",
    );
  }

  return createClient(url, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });
}
