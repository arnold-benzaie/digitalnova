import { defineConfig } from "drizzle-kit";
import { config } from "dotenv";
import { assertLocalOnlyDatabase } from "./db/guard-local-only";

config({ path: ".env.local" });

// PUBLIC-MAP — DATABASE TOOLING SAFETY / Phase S2. Deliberately a SEPARATE
// config from drizzle.config.ts (never modified by this file) and a
// SEPARATE env var (LOCAL_TEST_DATABASE_URL, never DATABASE_URL, no
// fallback) — the same "distinct variable name" discipline
// AUDIT_DATABASE_URL already established, so a developer's own shell/
// .env.local state for the main DATABASE_URL can never be silently reused
// here. Belt-and-suspenders: even `drizzle-kit generate` (which never
// touches a live database) is guarded here, so a misconfigured
// LOCAL_TEST_DATABASE_URL is caught the moment drizzle-kit reads this
// config, not just at `push` time — same reasoning already applied in
// drizzle-audit.config.ts.
assertLocalOnlyDatabase(process.env.LOCAL_TEST_DATABASE_URL, "LOCAL_TEST_DATABASE_URL");

export default defineConfig({
  schema: "./db/schema.ts",
  out: "./db/migrations",
  dialect: "postgresql",
  dbCredentials: {
    url: process.env.LOCAL_TEST_DATABASE_URL!,
  },
});
