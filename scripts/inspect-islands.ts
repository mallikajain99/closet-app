/**
 * List every region the hanger-removal pass considers erasing, and say why each was
 * kept or dropped.
 *
 *   npx tsx scripts/inspect-islands.ts "Blush ribbed cropped tank"
 *
 * The bar across a scoop neckline survived three different rules written to catch it,
 * each time for a reason guessed at rather than measured. This prints the measurement:
 * the garment's box, and every candidate island with its bounding box and the shape
 * test's verdict.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { createClient } from "@supabase/supabase-js";
import { config as loadEnv } from "dotenv";
import sharp from "sharp";

import {
  clothingColumn,
  clothingMask,
  clothingRow,
  fillInteriorHoles,
  growGate,
  readAlpha,
  readMask,
  removeBackground,
} from "@/lib/images/segment";

loadEnv({ path: ".env.local", quiet: true });

async function main() {
  const name = process.argv[2];
  if (!name) throw new Error("Pass an item name");

  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });
  const storage = createClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL!,
    process.env.SUPABASE_SERVICE_ROLE_KEY!,
  );

  const item = await db.item.findFirst({
    where: { name: { contains: name, mode: "insensitive" } },
    select: { name: true, originalImageKey: true },
  });
  if (!item?.originalImageKey) throw new Error(`No original for "${name}"`);
  console.log(item.name);

  const { data } = await storage.storage.from("closet-originals").download(item.originalImageKey);
  const source = Buffer.from(await (data as Blob).arrayBuffer());
  const [cutout, mask] = await Promise.all([removeBackground(source), clothingMask(source)]);

  const { width, height } = await sharp(cutout).metadata();
  if (!width || !height) throw new Error("no dimensions");

  const { bits } = await readMask(mask, width, height);
  const filled = fillInteriorHoles(bits, width, height);
  const holes = new Uint8Array(filled.length);
  for (let i = 0; i < filled.length; i += 1) holes[i] = filled[i] && !bits[i] ? 1 : 0;

  const sigma = Math.max(3, height * 0.014);
  const gate = await growGate(filled, width, height, sigma);
  const alpha = await readAlpha(cutout);

  const gateBits = new Uint8Array(gate.length);
  for (let i = 0; i < gate.length; i += 1) gateBits[i] = gate[i] >= 128 ? 1 : 0;
  const margin = Math.round(height * 0.01);
  const top = Math.max(0, clothingRow(gateBits, width, height, "top") - margin);
  const bottom = Math.min(height - 1, clothingRow(gateBits, width, height, "bottom") + margin);
  const left = Math.max(0, clothingColumn(gateBits, width, height, "left") - margin);
  const right = Math.min(width - 1, clothingColumn(gateBits, width, height, "right") + margin);

  console.log(`  image ${width}×${height} · gate sigma ${sigma.toFixed(1)}`);
  console.log(`  garment box  rows ${top}–${bottom}  cols ${left}–${right}`);

  const visited = new Uint8Array(alpha.length);
  const candidate = (i: number) => alpha[i] >= 128 && (gate[i] < 128 || holes[i] === 1);

  const islands: Array<{ n: number; minRow: number; maxRow: number; minCol: number; maxCol: number }> = [];
  for (let start = 0; start < alpha.length; start += 1) {
    if (visited[start] || !candidate(start)) continue;
    const stack = [start];
    visited[start] = 1;
    let n = 0, minRow = height, maxRow = 0, minCol = width, maxCol = 0;
    while (stack.length > 0) {
      const index = stack.pop()!;
      n += 1;
      const x = index % width;
      const y = (index - x) / width;
      if (y < minRow) minRow = y;
      if (y > maxRow) maxRow = y;
      if (x < minCol) minCol = x;
      if (x > maxCol) maxCol = x;
      for (const nb of [x > 0 ? index - 1 : -1, x < width - 1 ? index + 1 : -1,
                        y > 0 ? index - width : -1, y < height - 1 ? index + width : -1]) {
        if (nb < 0 || visited[nb] || !candidate(nb)) continue;
        visited[nb] = 1;
        stack.push(nb);
      }
    }
    islands.push({ n, minRow, maxRow, minCol, maxCol });
  }

  const garmentW = right - left + 1;
  const garmentH = bottom - top + 1;
  console.log(`  ${islands.length} candidate island(s), largest first:\n`);
  for (const b of islands.sort((a, z) => z.n - a.n).slice(0, 12)) {
    const w = b.maxCol - b.minCol + 1;
    const h = b.maxRow - b.minRow + 1;
    const inside = b.minRow >= top && b.maxRow <= bottom && b.minCol >= left && b.maxCol <= right;
    const wide = w >= garmentW * 0.25;
    const thin = h <= Math.max(4, height * 0.035);
    const ratio = w >= h * 4;
    const high = b.maxRow <= top + garmentH * 0.35;
    console.log(
      `    ${String(b.n).padStart(6)}px  ${String(w).padStart(4)}×${String(h).padStart(4)}  ` +
        `rows ${b.minRow}–${b.maxRow}  ` +
        `${inside ? "INSIDE " : "escapes"}  ` +
        `bar? wide=${wide} thin=${thin} ratio=${ratio} high=${high}`,
    );
  }
  await db.$disconnect();
}

main().catch((error: unknown) => {
  console.error(error);
  process.exit(1);
});
