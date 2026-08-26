// Unit tests for db/index.ts's resolveDatabaseUrl() — the fallback logic
// letting one Vercel Preview branch (via a branch-scoped
// PREVIEW_SCHEMA_DATABASE_URL) opt into the preview-schema sandbox for a
// real deployment, without touching what Production or any other Preview
// branch reads.
//
// No database connection: resolveDatabaseUrl() is a pure function of
// process.env. Importing "@/db" once at the top (required to reach it)
// does construct a real `pg` Pool at module load, but node-postgres never
// opens a socket until a query actually runs — so a syntactically-valid,
// never-dialed placeholder connection string is safe here. Every value
// used below is a placeholder, never a real credential.
//
// Run with: npx tsx --test db/index.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";

const ORIGINAL_ENV = { ...process.env };
process.env.DATABASE_URL = "postgresql://placeholder-never-dialed/db";

const { resolveDatabaseUrl } = await import("@/db");

function resetEnv() {
  delete process.env.VERCEL_ENV;
  delete process.env.PREVIEW_SCHEMA_DATABASE_URL;
  delete process.env.DATABASE_URL;
}

after(() => {
  // Restore exactly what was there before this file ran anything.
  resetEnv();
  Object.assign(process.env, ORIGINAL_ENV);
});

test("production + both variables set: DATABASE_URL is chosen", () => {
  resetEnv();
  process.env.VERCEL_ENV = "production";
  process.env.DATABASE_URL = "postgresql://placeholder-production/db";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-production/db");
});

test("preview + PREVIEW_SCHEMA_DATABASE_URL set: the Preview URL is chosen", () => {
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.DATABASE_URL = "postgresql://placeholder-shared-preview/db";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-preview-schema/db");
});

test("preview + PREVIEW_SCHEMA_DATABASE_URL absent: falls back to DATABASE_URL", () => {
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.DATABASE_URL = "postgresql://placeholder-shared-preview/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-shared-preview/db");
});

test("local/non-Vercel (VERCEL_ENV unset): DATABASE_URL is chosen even if PREVIEW_SCHEMA_DATABASE_URL is set", () => {
  resetEnv();
  process.env.DATABASE_URL = "postgresql://placeholder-local/db";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-local/db");
});

test("VERCEL_ENV=development (Vercel's own local/dev value): DATABASE_URL is chosen, never the Preview URL", () => {
  resetEnv();
  process.env.VERCEL_ENV = "development";
  process.env.DATABASE_URL = "postgresql://placeholder-local/db";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-local/db");
});

test("no URL available at all: resolves to undefined (the caller in db/index.ts throws on this)", () => {
  resetEnv();
  assert.equal(resolveDatabaseUrl(), undefined);
});

test("preview + only PREVIEW_SCHEMA_DATABASE_URL set (no DATABASE_URL): the Preview URL is chosen", () => {
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-preview-schema/db");
});
