/**
 * One-time normalization of free-text item metadata.
 *
 * Items saved before canonicalization existed can hold several spellings of the same
 * value ("Everlane" / "everlane"). This collapses each case-insensitive group onto a
 * single spelling.
 *
 * Which spelling wins: the one used most often, tie-broken by the earliest item. That
 * favours the user's habitual spelling rather than imposing a casing rule — the same
 * reasoning as lib/text.ts, where title-casing would wreck COS, ba&sh, lululemon.
 *
 *   npx tsx scripts/normalize-text.ts            # report only, changes nothing
 *   npx tsx scripts/normalize-text.ts --apply    # write the changes
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");

const COLUMN_FIELDS = ["brand", "size", "subcategory"] as const;
const ATTRIBUTE_FIELDS = ["material", "pattern"] as const;

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Short all-letter sizes are conventionally capitalised; everything else is left alone. */
function sizeRule(value: string) {
  return /^[a-z]{1,3}$/i.test(value) ? value.toUpperCase() : value;
}

type Occurrence = { value: string; createdAt: Date };

/** Most-used spelling wins; ties go to whichever appeared first. */
function pickWinner(occurrences: Occurrence[], isSize: boolean) {
  const counts = new Map<string, { count: number; first: Date; value: string }>();

  for (const { value, createdAt } of occurrences) {
    const existing = counts.get(value);
    if (existing) {
      existing.count += 1;
      if (createdAt < existing.first) existing.first = createdAt;
    } else {
      counts.set(value, { count: 1, first: createdAt, value });
    }
  }

  const ranked = [...counts.values()].sort(
    (a, b) => b.count - a.count || a.first.getTime() - b.first.getTime(),
  );

  return isSize ? sizeRule(ranked[0].value) : ranked[0].value;
}

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString) throw new Error("DATABASE_URL is not set.");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const items = await db.item.findMany({
    select: {
      id: true,
      userId: true,
      name: true,
      brand: true,
      size: true,
      subcategory: true,
      attributes: true,
      createdAt: true,
    },
    orderBy: { createdAt: "asc" },
  });

  console.log(`Scanning ${items.length} items…\n`);

  // Group per user — vocabularies are per-closet, not global.
  const winners = new Map<string, string>(); // `${userId}|${field}|${lowercased}` → winner
  const groups = new Map<string, Occurrence[]>();

  function record(userId: string, field: string, raw: unknown, createdAt: Date) {
    if (typeof raw !== "string") return;
    const value = normalizeWhitespace(raw);
    if (!value) return;
    const key = `${userId}|${field}|${value.toLowerCase()}`;
    const list = groups.get(key) ?? [];
    list.push({ value, createdAt });
    groups.set(key, list);
  }

  for (const item of items) {
    for (const field of COLUMN_FIELDS) {
      record(item.userId, field, item[field], item.createdAt);
    }
    const attributes = (item.attributes ?? {}) as Record<string, unknown>;
    for (const field of ATTRIBUTE_FIELDS) {
      record(item.userId, field, attributes[field], item.createdAt);
    }
  }

  for (const [key, occurrences] of groups) {
    const isSize = key.split("|")[1] === "size";
    winners.set(key, pickWinner(occurrences, isSize));
  }

  let changed = 0;

  for (const item of items) {
    const updates: Record<string, unknown> = {};
    const attributes = { ...((item.attributes ?? {}) as Record<string, unknown>) };
    let attributesChanged = false;

    for (const field of COLUMN_FIELDS) {
      const current = item[field];
      if (typeof current !== "string" || !current) continue;
      const winner = winners.get(
        `${item.userId}|${field}|${normalizeWhitespace(current).toLowerCase()}`,
      );
      if (winner && winner !== current) {
        console.log(`  ${item.name}  ·  ${field}: "${current}" → "${winner}"`);
        updates[field] = winner;
      }
    }

    for (const field of ATTRIBUTE_FIELDS) {
      const current = attributes[field];
      if (typeof current !== "string" || !current) continue;
      const winner = winners.get(
        `${item.userId}|${field}|${normalizeWhitespace(current).toLowerCase()}`,
      );
      if (winner && winner !== current) {
        console.log(`  ${item.name}  ·  ${field}: "${current}" → "${winner}"`);
        attributes[field] = winner;
        attributesChanged = true;
      }
    }

    if (attributesChanged) updates.attributes = attributes;
    if (Object.keys(updates).length === 0) continue;

    changed += 1;
    if (APPLY) {
      await db.item.update({ where: { id: item.id }, data: updates });
    }
  }

  console.log(
    changed === 0
      ? "\nNothing to change — every value is already consistent."
      : APPLY
        ? `\nUpdated ${changed} item(s).`
        : `\n${changed} item(s) would change. Re-run with --apply to write them.`,
  );

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
