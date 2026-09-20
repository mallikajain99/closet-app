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

import { estimatePriceCents } from "@/lib/items/estimate-price";
import sharp from "sharp";

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
  /** Only when legible on a care label — never inferred from appearance. */
  brand?: string;
  /** Likewise: only when printed on the label. */
  size?: string;
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

/** Long edge of the stored image. Plenty for segmentation; a 6 MB original is not. */
const MAX_EDGE = 2048;

/**
 * Normalize a photo for storage: correct rotation, downscale, strip metadata.
 *
 * Three things happen here, each worth doing:
 *
 * 1. **Orientation is baked into the pixels.** iPhone photos arrive as landscape pixels
 *    plus an EXIF orientation tag (these were tag 6 = rotate 90° CW). Browsers honour
 *    that, but image pipelines frequently don't — so the app would look right while
 *    background removal ran on a sideways garment. `sharp().rotate()` with no argument
 *    applies the EXIF rotation, whatever it says, then the tag is dropped.
 * 2. **Downscaled to a 2048px long edge.** These originals are ~5700px and 4–6 MB each;
 *    the segmentation models work around 1–2k px, so the extra pixels cost storage and
 *    upload time and buy nothing.
 * 3. **EXIF is stripped**, which removes the GPS coordinates iPhones embed — otherwise
 *    every garment photo carries the location it was taken at.
 */
async function toUploadable(path: string) {
  const ext = extname(path).toLowerCase();

  // sharp's prebuilt binaries don't always include libheif; sips always can.
  let input = path;
  if (ext === ".heic" || ext === ".heif") {
    input = join(mkdtempSync(join(tmpdir(), "closet-")), "converted.jpg");
    execFileSync("sips", ["-s", "format", "jpeg", path, "--out", input], { stdio: "pipe" });
  }

  const buffer = await sharp(readFileSync(input))
    .rotate()
    .resize({ width: MAX_EDGE, height: MAX_EDGE, fit: "inside", withoutEnlargement: true })
    .jpeg({ quality: 88, mozjpeg: true })
    .toBuffer();

  return { buffer, contentType: "image/jpeg", ext: ".jpg" };
}

function normalizeWhitespace(value: string) {
  return value.trim().replace(/\s+/g, " ");
}

const sleep = (ms: number) => new Promise((resolve) => setTimeout(resolve, ms));

/**
 * Retry an upload with backoff.
 *
 * Storage uploads of a few hundred KB back to back intermittently fail with a bare
 * "fetch failed" — a dropped connection rather than a rejection, so it succeeds on a
 * second attempt. Without this, a long batch reliably loses a handful of photos partway
 * through and needs babysitting.
 */
async function withRetry<T>(
  label: string,
  attempt: () => Promise<{ error: { message: string } | null } & T>,
  attempts = 4,
) {
  let lastMessage = "unknown error";

  for (let i = 1; i <= attempts; i += 1) {
    try {
      const result = await attempt();
      if (!result.error) return result;
      lastMessage = result.error.message;
    } catch (error) {
      lastMessage = error instanceof Error ? error.message : String(error);
    }

    if (i < attempts) {
      const delay = 500 * 2 ** (i - 1);
      console.log(`    ${label} failed (${lastMessage}) — retrying in ${delay}ms`);
      await sleep(delay);
    }
  }

  return { error: { message: `${lastMessage} (after ${attempts} attempts)` } } as never;
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

  /**
   * The storage client is rebuilt every few uploads.
   *
   * A single client reliably starts failing with a bare "fetch failed" after roughly
   * 16 consecutive uploads — its keep-alive connection pool degrades, and retries with
   * backoff don't recover it because the pool itself is the problem. A fresh process
   * always worked, which is what pointed at the client rather than the network. Cycling
   * the client gets the same effect without splitting a batch across runs.
   */
  const UPLOADS_PER_CLIENT = 10;
  // Bound to locals so the narrowing from the env check above survives into the closure.
  const newStorageClient = () =>
    createClient(supabaseUrl, serviceKey, {
      auth: { persistSession: false, autoRefreshToken: false },
    });

  let storage = newStorageClient();
  let uploadsOnClient = 0;

  function storageClient() {
    if (uploadsOnClient >= UPLOADS_PER_CLIENT) {
      storage = newStorageClient();
      uploadsOnClient = 0;
    }
    uploadsOnClient += 1;
    return storage;
  }

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
    select: { subcategory: true, brand: true, size: true, attributes: true },
  });
  const subcategories = existingItems
    .map((i) => i.subcategory)
    .filter((v): v is string => Boolean(v));
  const brands = existingItems
    .map((i) => i.brand)
    .filter((v): v is string => Boolean(v));
  const sizes = existingItems
    .map((i) => i.size)
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

    const { buffer, contentType, ext } = await toUploadable(path);
    const key = `${user.id}/${crypto.randomUUID()}${ext}`;

    const { error } = await withRetry("upload", () =>
      storageClient()
        .storage.from("closet-originals")
        .upload(key, buffer, { contentType, upsert: false }),
    );

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

    const subcategory = canonicalize(entry.subcategory, subcategories);
    const brand = canonicalize(entry.brand, brands);

    // Manifests carry no price, and an item without one has no cost-per-wear — the
    // number the whole app reports. Estimated on the same model the form uses, so a
    // bulk-imported garment and a hand-added one are never priced differently.
    const priceCents = estimatePriceCents({
      brand: brand ?? null,
      category: entry.category,
      subcategory: subcategory ?? null,
      attributes,
    });

    await db.item.create({
      data: {
        userId: user.id,
        name: normalizeWhitespace(entry.name),
        category: entry.category,
        subcategory,
        brand,
        size: canonicalize(entry.size, sizes),
        colors: entry.colors ?? [],
        seasons: entry.seasons ?? [],
        priceCents,
        attributes: { ...attributes, priceEstimated: true },
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
