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
  prisma: PrismaClient | undefined;
};

function getClient(): PrismaClient {
  if (!globalForPrisma.prisma) {
    globalForPrisma.prisma = createClient();
  }
  return globalForPrisma.prisma;
}

/**
 * Connects on first use, not at import.
 *
 * `next build` evaluates every route module while collecting page data. Constructing the
 * client eagerly made the *build* fail whenever DATABASE_URL was absent or mis-scoped,
 * even though no query runs at build time — a confusing failure, because the error names
 * a runtime concern during a build step. Deferring means a missing variable surfaces on
 * the first actual query, where it belongs.
 */
export const db = new Proxy({} as PrismaClient, {
  get(_target, property) {
    const client = getClient();
    const value = Reflect.get(client, property, client);
    // Re-bind methods so `this` stays the real client rather than the proxy.
    return typeof value === "function" ? value.bind(client) : value;
  },
});
