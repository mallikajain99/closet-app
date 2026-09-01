import { LoginForm } from "@/components/auth/login-form";

export default async function LoginPage(props: PageProps<"/login">) {
  const searchParams = await props.searchParams;
  const next = typeof searchParams.next === "string" ? searchParams.next : "/";
  const hadLinkError = searchParams.error === "link";

  return (
    <main className="mx-auto flex w-full max-w-sm flex-1 flex-col justify-center px-6 py-16">
      <p className="label text-ink-subtle">Digital Closet Manager</p>
      <h1 className="mt-4 text-3xl font-light tracking-tight">Sign in</h1>
      <p className="mt-3 text-meta text-ink-muted">
        We&rsquo;ll email you a link. No password to remember.
      </p>

      {hadLinkError && (
        <p className="mt-6 border-l-2 border-signal-danger bg-surface-sunken py-2 pl-3 text-meta text-ink-muted">
          That link didn&rsquo;t work — it may have expired or already been
          used. Request a new one below.
        </p>
      )}

      <LoginForm next={next} />
    </main>
  );
}
