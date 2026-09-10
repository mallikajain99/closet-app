/**
 * Bulk-import closet photos with pre-written metadata.
 *
 * Intended for cataloguing a backlog: the photos are described once in a manifest, then
 * uploaded and inserted in one pass, and refined in the app afterwards.
 *
 *   npx tsx scripts/import-photos.ts --manifest batch-01.json           # report only
 *   npx tsx scripts/import-photos.ts --manifest batch-01.json --apply   # write
 *
 * Manifest shape (one entry per photo; only `file`, `name` and `category` are required):
 *
 *   [
 *     {
 *       "file": "IMG_1234.heic",
 *       "name": "Butter yellow crewneck knit sweater",
 *       "category": "TOP",
 *       "subcategory": "sweater",
 *       "colors": ["butter yellow"],
 *       "seasons": ["FALL", "WINTER"],
 *       "sleeveLength": "long",
 *       "formality": "casual",
 *       "material": "knit",
 *       "pattern": "solid",
 *       "silhouette": ["relaxed"],
 *       "tagNames": ["work"]
 *     }
 *   ]
 *
 * Price, brand, size and purchase date are intentionally absent: they aren't visible in a
 * photo, and an invented price would corrupt cost-per-wear. Fill them in the app.
 */

import { execFileSync } from "node:child_process";
import { readFileSync, existsSync, writeFileSync, mkdtempSync } from "node:fs";
import { tmpdir } from "node:os";
import { join, extname } from "node:path";

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient, type Category, type Season } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const PHOTO_DIR =
  argValue("--dir") ?? join(process.env.HOME ?? "", "Desktop", "closet-photos");
const MANIFEST = argValue("--manifest");

/** Records what has already been imported so a re-run tops up rather than duplicates. */
const LEDGER = join(PHOTO_DIR, ".imported.json");

function argValue(flag: string) {
  const index = process.argv.indexOf(flag);
  return index === -1 ? undefined : process.argv[index + 1];
}

type ManifestEntry = {
  file: string;
  name: string;
  category: Category;
  subcategory?: string;
  colors?: string[];
  seasons?: Season[];
  sleeveLength?: string;
  formality?: string;
  material?: string;
  pattern?: string;
  silhouette?: string[];
  tagNames?: string[];
};

/**
 * HEIC is converted to JPEG on the way in.
 *
 * iPhone photos are HEIC, which Chrome and Firefox cannot display — they would upload
 * fine and then render as broken images. `sips` ships with macOS, so this needs no
 * image library.
 */
function toUploadable(path: string): { buffer: Buffer; contentType: string; ext: string } {
  const ext = extname(path).toLowerCase();

  if (ext === ".heic" || ext === ".heif") {
    const out = join(mkdtempSync(join(tmpdir(), "closet-")), "converted.jpg");
    execFileSync("sips", ["-s", "format", "jpeg", path, "--out", out], {
      stdio: "pipe",
    });
    return { buffer: readFileSync(out), contentType: "image/jpeg", ext: ".jpg" };
  }

  const contentType =
    ext === ".png" ? "image/png" : ext === ".webp" ? "image/webp" : "image/jpeg";
  return { buffer: readFileSync(path), contentType, ext };
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

/** Reuse a spelling already in the closet, so bulk import doesn't refragment the vocabulary. */
function canonicalize(value: string | undefined, existing: string[]) {
  if (!value) return undefined;
  const cleaned = normalizeWhitespace(value);
  if (!cleaned) return undefined;
  return (
    existing.find((candidate) => candidate.toLowerCase() === cleaned.toLowerCase()) ??
    cleaned
  );
}

async function main() {
  if (!MANIFEST) throw new Error("Pass --manifest <file.json>");

  const connectionString = process.env.DATABASE_URL;
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY;
  if (!connectionString || !supabaseUrl || !serviceKey) {
    throw new Error("DATABASE_URL, NEXT_PUBLIC_SUPABASE_URL and SUPABASE_SERVICE_ROLE_KEY must be set.");
  }

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });
  const storage = createClient(supabaseUrl, serviceKey, {
    auth: { persistSession: false, autoRefreshToken: false },
  });

  const users = await db.user.findMany({ select: { id: true, email: true } });
  if (users.length !== 1) {
    throw new Error(
      `Expected exactly one user, found ${users.length}. Pass a user explicitly if this becomes multi-user.`,
    );
  }
  const user = users[0];

  const entries: ManifestEntry[] = JSON.parse(readFileSync(MANIFEST, "utf8"));
  const imported: string[] = existsSync(LEDGER)
    ? JSON.parse(readFileSync(LEDGER, "utf8"))
    : [];

  // Existing vocabularies, so imported values match what's already in the closet.
  const existingItems = await db.item.findMany({
    where: { userId: user.id },
    select: { subcategory: true, attributes: true },
  });
  const subcategories = existingItems
    .map((i) => i.subcategory)
    .filter((v): v is string => Boolean(v));
  const materials = new Set<string>();
  const patterns = new Set<string>();
  for (const item of existingItems) {
    const attributes = (item.attributes ?? {}) as Record<string, unknown>;
    if (typeof attributes.material === "string") materials.add(attributes.material);
    if (typeof attributes.pattern === "string") patterns.add(attributes.pattern);
  }

  console.log(`${entries.length} entry(ies) in manifest · user ${user.email}\n`);

  let created = 0;
  let skipped = 0;

  for (const entry of entries) {
    const path = join(PHOTO_DIR, entry.file);

    if (imported.includes(entry.file)) {
      console.log(`  skip (already imported): ${entry.file}`);
      skipped += 1;
      continue;
    }
    if (!existsSync(path)) {
      console.log(`  MISSING FILE: ${entry.file}`);
      skipped += 1;
      continue;
    }

    console.log(`  ${entry.file}  →  ${entry.name}  [${entry.category}]`);
    if (!APPLY) continue;

    const { buffer, contentType, ext } = toUploadable(path);
    const key = `${user.id}/${crypto.randomUUID()}${ext}`;

    const { error } = await storage.storage
      .from("closet-originals")
      .upload(key, buffer, { contentType, upsert: false });

    if (error) {
      console.log(`    upload failed: ${error.message}`);
      skipped += 1;
      continue;
    }

    const tags = await Promise.all(
      (entry.tagNames ?? []).map((name) =>
        db.tag.upsert({
          where: { userId_name: { userId: user.id, name } },
          update: {},
          create: { userId: user.id, name },
        }),
      ),
    );

    const attributes: Record<string, string | string[]> = {};
    if (entry.sleeveLength) attributes.sleeveLength = entry.sleeveLength;
    if (entry.formality) attributes.formality = entry.formality;
    const material = canonicalize(entry.material, [...materials]);
    if (material) attributes.material = material;
    const pattern = canonicalize(entry.pattern, [...patterns]);
    if (pattern) attributes.pattern = pattern;
    if (entry.silhouette?.length) attributes.silhouette = entry.silhouette;

    await db.item.create({
      data: {
        userId: user.id,
        name: normalizeWhitespace(entry.name),
        category: entry.category,
        subcategory: canonicalize(entry.subcategory, subcategories),
        colors: entry.colors ?? [],
        seasons: entry.seasons ?? [],
        attributes,
        originalImageKey: key,
        processingStatus: "PENDING",
        tags: { create: tags.map((tag) => ({ tagId: tag.id })) },
      },
    });

    imported.push(entry.file);
    // Written after every item so an interrupted run doesn't re-upload what succeeded.
    writeFileSync(LEDGER, JSON.stringify(imported, null, 2));
    created += 1;
  }

  console.log(
    APPLY
      ? `\nCreated ${created} item(s)${skipped ? `, skipped ${skipped}` : ""}.`
      : `\nDry run — ${entries.length - skipped} item(s) would be created. Re-run with --apply.`,
  );

  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
