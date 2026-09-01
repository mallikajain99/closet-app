import { NextResponse } from "next/server";

import { createClient } from "@/lib/supabase/server";

/**
 * Magic-link landing route. Supabase redirects here with a one-time `code`, which is
 * exchanged for a session cookie.
 */
export async function GET(request: Request) {
  const { searchParams, origin } = new URL(request.url);
  const code = searchParams.get("code");
  const next = searchParams.get("next") ?? "/";

  // Only allow relative redirects — an absolute URL here would be an open redirect.
  const destination = next.startsWith("/") ? next : "/";

  if (code) {
    const supabase = await createClient();
    const { error } = await supabase.auth.exchangeCodeForSession(code);
    if (!error) {
      return NextResponse.redirect(`${origin}${destination}`);
    }
  }

  return NextResponse.redirect(`${origin}/login?error=link`);
}
