import { config as loadEnv } from "dotenv";
import { defineConfig } from "prisma/config";

// Next.js reads .env.local; Prisma defaults to .env. Load .env.local explicitly so the
// project has a single env file rather than two that drift apart.
loadEnv({ path: ".env.local", quiet: true });

/**
 * Prisma 7 configuration.
 *
 * Connection URLs no longer live in schema.prisma. This file supplies the URL used by
 * migration and introspection commands; the running application connects separately
 * through a driver adapter (see lib/db.ts).
 *
 * Migrations use DIRECT_URL (port 5432) rather than the pooled URL — schema changes
 * cannot run through PgBouncer. See SETUP.md §1.2.
 */
export default defineConfig({
  schema: "prisma/schema.prisma",
  datasource: {
    // Read directly rather than via Prisma's env() helper, which throws at config-load
    // time when the variable is absent. That would make `prisma validate` and
    // `prisma generate` fail before Supabase credentials exist. Commands that actually
    // need a connection still fail with a clear error.
    url: process.env.DIRECT_URL ?? "",
  },
  migrations: {
    path: "prisma/migrations",
  },
});
