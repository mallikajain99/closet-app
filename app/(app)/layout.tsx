import Link from "next/link";

import { SignOutButton } from "@/components/auth/sign-out-button";
import { requireUser } from "@/lib/auth";

// The wordmark used to sit to the left of these, reading "Closet" and linking to `/` —
// so the bar offered two tabs called Closet, going to different places. Home is a
// destination like the rest, so it is simply the first tab.
const NAV = [
  { href: "/", label: "Home" },
  { href: "/catalog", label: "Closet" },
  { href: "/outfits", label: "Outfits" },
  { href: "/calendar", label: "Calendar" },
  { href: "/inspiration", label: "Inspiration" },
] as const;

export default async function AppLayout({ children }: LayoutProps<"/">) {
  const user = await requireUser();

  return (
    <>
      <header className="border-b border-line">
        <div className="mx-auto flex w-full max-w-5xl items-center gap-6 px-6 py-4">
          <nav className="flex gap-5">
            {NAV.map((item) => (
              <Link
                key={item.href}
                href={item.href}
                className="label text-ink-subtle transition-colors hover:text-ink"
              >
                {item.label}
              </Link>
            ))}
          </nav>

          <div className="ml-auto flex items-center gap-4">
            <span className="text-meta text-ink-subtle">{user.email}</span>
            <SignOutButton />
          </div>
        </div>
      </header>

      <div className="flex flex-1 flex-col">{children}</div>
    </>
  );
}
