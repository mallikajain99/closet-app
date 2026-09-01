import { db } from "@/lib/db";
import { requireUser } from "@/lib/auth";

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

export default async function Home() {
  const user = await requireUser();

  // Doubles as a live check that the pooled connection works end to end.
  const [itemCount, outfitCount, wearCount] = await Promise.all([
    db.item.count({ where: { userId: user.id } }),
    db.outfit.count({ where: { userId: user.id } }),
    db.wearLog.count({ where: { userId: user.id } }),
  ]);

  const stats = [
    { label: "Items", value: itemCount },
    { label: "Outfits", value: outfitCount },
    { label: "Wears logged", value: wearCount },
  ];

  return (
    <main className="mx-auto w-full max-w-5xl px-6 py-16">
      <h1 className="text-4xl font-light tracking-tight">
        Your closet is empty.
      </h1>
      <p className="mt-4 max-w-md text-meta leading-relaxed text-ink-muted">
        Signed in and connected to the database. Phase 1 adds item intake, so
        there will be something to put here.
      </p>

      <dl className="mt-12 flex gap-12 border-t border-line pt-6">
        {stats.map((stat) => (
          <div key={stat.label}>
            <dt className="label text-ink-subtle">{stat.label}</dt>
            <dd className="mt-1 text-3xl font-light tabular-nums">
              {stat.value}
            </dd>
          </div>
        ))}
      </dl>

      <ol className="mt-16 border-t border-line">
        {phases.map((phase) => (
          <li
            key={phase.n}
            className="flex items-baseline gap-4 border-b border-line py-3"
          >
            <span className="label w-12 shrink-0 text-ink-subtle">
              {phase.n}
            </span>
            <span
              className={phase.status === "current" ? "text-ink" : "text-ink-subtle"}
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
