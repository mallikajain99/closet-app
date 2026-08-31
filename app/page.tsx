const phases = [
  { n: "00", name: "Foundation", status: "current" },
  { n: "01", name: "Catalog", status: "next" },
  { n: "02", name: "Image pipeline", status: "next" },
  { n: "02.5", name: "Mannequin calibration", status: "next" },
  { n: "03", name: "Browse & item detail", status: "next" },
  { n: "04", name: "Outfit builder", status: "next" },
  { n: "05", name: "Wear tracking", status: "next" },
  { n: "06", name: "Analytics", status: "next" },
] as const;

export default function Home() {
  return (
    <main className="mx-auto flex w-full max-w-2xl flex-1 flex-col justify-center px-6 py-16">
      <p className="label text-ink-subtle">Digital Closet Manager</p>

      <h1 className="mt-4 text-4xl font-light tracking-tight text-ink">
        Foundation in place.
      </h1>

      <p className="mt-4 max-w-md text-meta leading-relaxed text-ink-muted">
        Next.js, Tailwind, and the full Prisma schema are wired up. Add Supabase
        credentials to <code className="text-ink">.env.local</code>, run the
        first migration, and Phase 1 can begin.
      </p>

      <ol className="mt-12 border-t border-line">
        {phases.map((phase) => (
          <li
            key={phase.n}
            className="flex items-baseline gap-4 border-b border-line py-3"
          >
            <span className="label w-12 shrink-0 text-ink-subtle">
              {phase.n}
            </span>
            <span
              className={
                phase.status === "current"
                  ? "text-ink"
                  : "text-ink-subtle"
              }
            >
              {phase.name}
            </span>
            {phase.status === "current" && (
              <span className="label ml-auto text-signal-value">Current</span>
            )}
          </li>
        ))}
      </ol>
    </main>
  );
}
