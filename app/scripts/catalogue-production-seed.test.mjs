// Integration tests for scripts/catalogue-production-seed.mjs.
//
// LOCAL DISPOSABLE DOCKER DB ONLY (public_map_approval_test, port 5434) —
// same guard convention used everywhere else in this repo. Never Preview,
// never Production. The script under test is exercised as a real child
// process (it's a CLI script with top-level await and process.exit calls,
// same shape as scripts/catalogue-preview-seed.mjs, which has no test file
// of its own to mirror) so these tests observe its actual behavior,
// including the interactive --execute/APPLY confirmation, not a re-
// implementation of its logic.
//
// Run with: npx tsx --test scripts/catalogue-production-seed.test.mjs
import { test, before, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { spawn } from "node:child_process";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, join } from "node:path";
import pg from "pg";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Preview/Production. Arrêt avant tout test.");
}

const HERE = dirname(fileURLToPath(import.meta.url));
const SCRIPT_PATH = join(HERE, "catalogue-production-seed.mjs");
const REPO_ROOT = join(HERE, "..");

const journal = JSON.parse(readFileSync(join(REPO_ROOT, "db", "migrations", "meta", "_journal.json"), "utf8"));
const MIGRATION_0029 = journal.entries.find((e) => e.tag === "0029_heavy_the_fallen");
assert.ok(MIGRATION_0029, "0029_heavy_the_fallen must exist in the journal for these tests to be meaningful");

const client = new pg.Client({ connectionString: LOCAL_DB_URL });
await client.connect();

async function ensureMigrationsTable() {
  await client.query(`CREATE SCHEMA IF NOT EXISTS drizzle`);
  await client.query(`CREATE TABLE IF NOT EXISTS drizzle.__drizzle_migrations (id serial PRIMARY KEY, hash text, created_at bigint)`);
}

async function setMigrationPresent(present) {
  await client.query(`DELETE FROM drizzle.__drizzle_migrations WHERE created_at = $1`, [MIGRATION_0029.when]);
  if (present) {
    await client.query(`INSERT INTO drizzle.__drizzle_migrations (hash, created_at) VALUES ('test-fixture-hash', $1)`, [MIGRATION_0029.when]);
  }
}

async function clearCatalogueTables() {
  await client.query("DELETE FROM service_legacy_identifiers");
  await client.query("DELETE FROM service_relations");
  await client.query("DELETE FROM service_market_offers");
  await client.query("DELETE FROM services");
}

async function catalogueCounts() {
  // Sequential, not Promise.all: this shared `client` is a single
  // pg.Client connection, which doesn't support concurrent in-flight
  // queries.
  const s = await client.query("SELECT count(*)::int AS n FROM services");
  const o = await client.query("SELECT count(*)::int AS n FROM service_market_offers");
  const r = await client.query("SELECT count(*)::int AS n FROM service_relations");
  const l = await client.query("SELECT count(*)::int AS n FROM service_legacy_identifiers");
  return { services: s.rows[0].n, offers: o.rows[0].n, relations: r.rows[0].n, legacy: l.rows[0].n };
}

/** Spawns the real script as a child process with a controlled, minimal
 * environment — never inherits the parent's own PREVIEW_SCHEMA_DATABASE_URL
 * or VERCEL_ENV unless a test explicitly asks for them. */
function runScript({ args = [], env = {}, stdin = null } = {}) {
  return new Promise((resolve) => {
    // The script loads .env.local itself via dotenv — and THIS worktree's
    // .env.local (a diagnostic artifact specific to this engagement, never
    // present in a normal checkout) happens to define
    // PREVIEW_SCHEMA_DATABASE_URL. dotenv never overrides an already-set
    // process.env value, so explicitly setting it to "" here (distinct
    // from leaving it unset) is what actually keeps a "clean" test
    // scenario clean — an empty string is falsy, so the script's own
    // truthy check correctly treats it as absent.
    const child = spawn("npx", ["tsx", SCRIPT_PATH, ...args], {
      cwd: REPO_ROOT,
      env: { PATH: process.env.PATH, HOME: process.env.HOME, DATABASE_URL: LOCAL_DB_URL, PREVIEW_SCHEMA_DATABASE_URL: "", ...env },
    });
    let stdout = "";
    let stderr = "";
    child.stdout.on("data", (d) => (stdout += d));
    child.stderr.on("data", (d) => (stderr += d));
    if (stdin !== null) {
      child.stdin.write(stdin);
    }
    child.stdin.end();
    child.on("close", (code) => resolve({ code, stdout, stderr }));
  });
}

before(async () => {
  await ensureMigrationsTable();
});

beforeEach(async () => {
  await clearCatalogueTables();
});

after(async () => {
  await setMigrationPresent(false);
  await clearCatalogueTables();
  await client.end();
});

test("dry-run on a correctly migrated, empty local DB: PASS and rolls back (nothing persisted)", async () => {
  await setMigrationPresent(true);
  const { code, stdout } = await runScript();
  assert.equal(code, 0, stdout);
  assert.match(stdout, /DRY-RUN — ROLLBACK effectué/);
  const counts = await catalogueCounts();
  assert.deepEqual(counts, { services: 0, offers: 0, relations: 0, legacy: 0 }, "dry-run must never persist anything");
});

test("--execute + APPLY on empty local DB: commits exactly 32/52/19/30", async () => {
  await setMigrationPresent(true);
  const { code, stdout } = await runScript({ args: ["--execute"], stdin: "APPLY\n" });
  assert.equal(code, 0, stdout);
  assert.match(stdout, /COMMIT/);
  const counts = await catalogueCounts();
  assert.deepEqual(counts, { services: 32, offers: 52, relations: 19, legacy: 30 });
});

test("a second --execute + APPLY run stays idempotent: still exactly 32/52/19/30", async () => {
  await setMigrationPresent(true);
  await runScript({ args: ["--execute"], stdin: "APPLY\n" }); // first run seeds
  const { code, stdout } = await runScript({ args: ["--execute"], stdin: "APPLY\n" }); // second run
  assert.equal(code, 0, stdout);
  const counts = await catalogueCounts();
  assert.deepEqual(counts, { services: 32, offers: 52, relations: 19, legacy: 30 }, "ON CONFLICT DO NOTHING must prevent any duplication");
});

test("missing migration 0029 record: REFUSE, nothing inserted", async () => {
  await setMigrationPresent(false);
  const { code, stdout, stderr } = await runScript();
  assert.notEqual(code, 0);
  assert.match(stdout + stderr, /0029_heavy_the_fallen.*n'est pas enregistrée|ROLLBACK effectué/);
  const counts = await catalogueCounts();
  assert.deepEqual(counts, { services: 0, offers: 0, relations: 0, legacy: 0 });
});

test("wrong current_schema(): REFUSE, nothing inserted", async () => {
  await setMigrationPresent(true);
  await client.query(`CREATE SCHEMA IF NOT EXISTS pm_test_wrong_schema`);
  const wrongSchemaUrl = `${LOCAL_DB_URL}?options=-c%20search_path%3Dpm_test_wrong_schema`;
  const { code, stdout, stderr } = await runScript({ env: { DATABASE_URL: wrongSchemaUrl } });
  assert.notEqual(code, 0);
  assert.match(stdout + stderr, /current_schema\(\)/);
  const counts = await catalogueCounts();
  assert.deepEqual(counts, { services: 0, offers: 0, relations: 0, legacy: 0 });
  await client.query(`DROP SCHEMA IF EXISTS pm_test_wrong_schema CASCADE`);
});

test('VERCEL_ENV="preview": REFUSE before any DB connection is attempted', async () => {
  await setMigrationPresent(true);
  const { code, stdout, stderr } = await runScript({ env: { VERCEL_ENV: "preview" } });
  assert.notEqual(code, 0);
  assert.match(stdout + stderr, /VERCEL_ENV/);
});

test("PREVIEW_SCHEMA_DATABASE_URL present in the environment: REFUSE before any DB connection is attempted", async () => {
  await setMigrationPresent(true);
  const { code, stdout, stderr } = await runScript({ env: { PREVIEW_SCHEMA_DATABASE_URL: "postgresql://placeholder-never-dialed/db" } });
  assert.notEqual(code, 0);
  assert.match(stdout + stderr, /PREVIEW_SCHEMA_DATABASE_URL/);
});

// A "dataset altéré/incomplet -> REFUS" scenario is deliberately NOT
// exercised as a live child-process run here: doing so would require
// either mutating the real, human-approved db/catalogue/canonical-dataset.mjs
// (explicitly forbidden — that file is the P0.1B.2 approved source of
// truth) or restructuring this script into an exported-function module
// purely to enable cross-process test mocking, which is a bigger scope
// change than "a script shaped like catalogue-preview-seed.mjs". The
// validation logic that would run in that scenario is byte-for-byte
// identical to catalogue-preview-seed.mjs's own (already relied upon in
// this repo), and the real dataset's own structural correctness is
// already exhaustively covered by db/catalogue/canonical-dataset.test.mjs
// (19 tests, part of the existing safe suite).
