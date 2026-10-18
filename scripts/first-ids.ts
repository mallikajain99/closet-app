/**
 * Print one real path for each detail route, for check-pages.sh to load.
 *
 * Parameterless routes are the easy half. The failures that actually reach the user
 * have twice now been on a page that needs an id — and a dynamic route is never
 * rendered by `next build`, so nothing but loading it finds them.
 */
import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";
import { config as loadEnv } from "dotenv";

loadEnv({ path: ".env.local", quiet: true });

async function main() {
  const db = new PrismaClient({
    adapter: new PrismaPg({ connectionString: process.env.DATABASE_URL! }),
  });

  const [outfit, item, inspiration] = await Promise.all([
    db.outfit.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }),
    db.item.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }),
    db.inspiration.findFirst({ select: { id: true }, orderBy: { createdAt: "desc" } }),
  ]);

  const paths = [
    outfit && `/outfits/${outfit.id}`,
    outfit && `/outfits/${outfit.id}/edit`,
    item && `/catalog/${item.id}`,
    item && `/catalog/${item.id}/edit`,
    inspiration && `/inspiration/${inspiration.id}`,
    `/calendar/${new Date().toISOString().slice(0, 10)}`,
  ].filter(Boolean);

  console.log(paths.join(" "));
  await db.$disconnect();
}

main();
