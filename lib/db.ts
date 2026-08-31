import { PrismaPg } from "@prisma/adapter-pg";
import { PrismaClient } from "@prisma/client";

/**
 * Prisma 7 connects through a driver adapter rather than a URL in schema.prisma.
 *
 * Uses DATABASE_URL — the *pooled* Supabase connection (port 6543). Serverless
 * functions open many short-lived connections and would exhaust Postgres without
 * PgBouncer in front. Migrations use DIRECT_URL instead; see prisma.config.ts.
 */
function createClient() {
  const connectionString = process.env.DATABASE_URL;

  if (!connectionString) {
    throw new Error(
      "DATABASE_URL is not set. Copy the pooled connection string from Supabase into .env.local — see SETUP.md §1.2.",
    );
  }

  return new PrismaClient({
    adapter: new PrismaPg({ connectionString }),
  });
}

// Reuse the client across hot reloads in development; without this, every edit opens a
// new connection pool and the database runs out of connections.
const globalForPrisma = globalThis as unknown as {
  prisma: ReturnType<typeof createClient> | undefined;
};

export const db = globalForPrisma.prisma ?? createClient();

if (process.env.NODE_ENV !== "production") {
  globalForPrisma.prisma = db;
}
