/**
 * Run the image pipeline over catalog items: background removal, then normalization
 * onto the shared canvas.
 *
 *   npx tsx scripts/process-images.ts --limit 5            # report only
 *   npx tsx scripts/process-images.ts --limit 5 --apply    # process and store
 *   npx tsx scripts/process-images.ts --apply              # everything still pending
 *   npx tsx scripts/process-images.ts --apply --redo       # re-run items already done
 *
 * New items are processed automatically by the catalog Server Actions; this script is
 * the backfill and retry path. The processing itself lives in `lib/images/pipeline.ts`
 * so both callers behave identically.
 *
 * Originals are never touched. Results are written alongside them, and an item whose
 * processing fails keeps showing its original photo.
 */

import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

const APPLY = process.argv.includes("--apply");
const REDO = process.argv.includes("--redo");
const LIMIT = (() => {
  const i = process.argv.indexOf("--limit");
  return i === -1 ? undefined : Number(process.argv[i + 1]);
})();

/** Substring match on item name, for trialling specific hard cases before a full run. */
const MATCH = (() => {
  const i = process.argv.indexOf("--match");
  return i === -1 ? undefined : process.argv[i + 1];
})();

async function main() {
  const connectionString = process.env.DATABASE_URL;
  if (!connectionString || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    throw new Error("Supabase env vars are missing — see SETUP.md.");
  }

  // Imported after dotenv has run, and lazily so a dry run needs no Replicate token.
  const { runPipeline } = await import("../lib/images/pipeline");

  const db = new PrismaClient({ adapter: new PrismaPg({ connectionString }) });

  const items = await db.item.findMany({
    where: {
      NOT: { originalImageKey: null },
      // OVERRIDDEN is excluded even under --redo: the user chose the original on purpose.
      ...(REDO
        ? { processingStatus: { not: "OVERRIDDEN" as const } }
        : { processingStatus: { in: ["PENDING", "PROCESSING", "FAILED"] } }),
      ...(MATCH ? { name: { contains: MATCH, mode: "insensitive" as const } } : {}),
    },
    orderBy: { createdAt: "asc" },
    take: LIMIT,
    select: { id: true, name: true, category: true, originalImageKey: true },
  });

  console.log(`${items.length} item(s) to process${APPLY ? "" : " (dry run)"}\n`);

  let done = 0;
  let failed = 0;

  for (const item of items) {
    process.stdout.write(`  ${item.name} [${item.category}] … `);

    if (!APPLY) {
      console.log("would process");
      continue;
    }

    const result = await runPipeline(
      db,
      { id: item.id, category: item.category, originalImageKey: item.originalImageKey! },
      (delay) => process.stdout.write(`retrying in ${delay / 1000}s … `),
    );

    if (result.ok) {
      const { trimmedSize, fitted } = result;
      console.log(
        `ok  (cutout ${trimmedSize.width}×${trimmedSize.height} → ${fitted.width}×${fitted.height})`,
      );
      done += 1;
    } else {
      console.log(`FAILED — ${result.error}`);
      failed += 1;
    }
  }

  if (APPLY) console.log(`\nProcessed ${done}${failed ? `, ${failed} failed` : ""}.`);
  await db.$disconnect();
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
