import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { assertNotMainProductionDatabase } from "./db/guard-main-production";

config({ path: ".env.local" });

if (!process.env.AUDIT_DATABASE_URL) {
  throw new Error("AUDIT_DATABASE_URL is not set — see .env.example. This must be a SEPARATE Supabase project from DATABASE_URL.");
}

// Belt-and-suspenders: even `drizzle-kit generate` (which never touches a
// live database) is guarded here, so a mistyped AUDIT_DATABASE_URL is
// caught the moment drizzle-kit reads this config, not just at `push` time.
assertNotMainProductionDatabase(process.env.AUDIT_DATABASE_URL, "AUDIT_DATABASE_URL");

export default defineConfig({
  schema: "./db/audit-schema.ts",
  out: "./db/audit-migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.AUDIT_DATABASE_URL,
  },
});
