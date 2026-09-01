#!/usr/bin/env node
/**
 * PHASE RBAC-MIG-TOOLING — reviewed main-DB migration tool.
 *
 * ⚠ TOOLING ONLY. This script DOES NOT authorize production execution.
 *   A real protected-DB apply requires SEPARATE human authorization,
 *   `--apply`, the typed token "MIGRATE", and all three production
 *   signals (see scripts/lib/protected-db-target.mjs). See
 *   scripts/RBAC-BOOTSTRAP-PROCEDURE.md.
 *
 * Applies db/migrations/ to the MAIN PUBLIC-MAP database via drizzle-orm's
 * migrate() REPLAY (drizzle-orm/node-postgres/migrator) — NOT
 * `drizzle-kit push`. `push` diffs the live schema and would NOT run
 * migration 0034's hand-appended `INSERT INTO "staff_roles"` seed (see
 * db/schema.rbac.integration.test.mjs and scripts/audit-db-migrate.mjs:99).
 * migrate() replays each committed migration file statement-by-statement,
 * in one Postgres transaction (drizzle-orm 0.45.2, pg-core dialect), so a
 * failure rolls back atomically and a completed migration is a no-op on
 * re-run.
 *
 * DEFAULT MODE = INSPECTION. It:
 *   - parses/validates operator inputs,
 *   - reads db/migrations/meta/_journal.json + the .sql files locally,
 *   - reports which migrations WOULD be replayed and confirms 0034 and
 *     its staff_roles seed are present,
 *   - opens NO connection and performs ZERO mutation.
 *   migrate() is NEVER called without `--apply`.
 *
 * REAL APPLY (`--apply`) opens a connection, reads `select
 * current_database()`, classifies the target, refuses anything that is
 * not a positively-identified PRODUCTION-MAIN (or an explicit
 * RBAC_MIG_TEST_MODE=1 disposable container), prints the redacted target,
 * requires the typed token "MIGRATE", then replays.
 *
 * Never prints DATABASE_URL, credentials, or tokens.
 *
 * Usage:
 *   npx tsx scripts/db-migrate.mjs
 *       inspection only — no connection, no mutation
 *   RBAC_BOOTSTRAP_TARGET=production-main npx tsx scripts/db-migrate.mjs --apply --expected-db <name>
 *       real apply against DATABASE_URL, guarded (needs all three signals + typed MIGRATE)
 *   RBAC_MIG_TEST_MODE=1 npx tsx scripts/db-migrate.mjs --apply --db-url <127.0.0.1 url>
 *       disposable-container apply only (used by the integration test)
 */
import { config as loadDotenv } from "dotenv";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  classifyTarget,
  PRODUCTION_ENV_MARKER_ENV,
  TEST_MODE_ENV,
} from "./lib/protected-db-target.mjs";

export const CONFIRMATION_TOKEN = "MIGRATE";
export const MIGRATIONS_FOLDER = "db/migrations";
export const REQUIRED_MIGRATION_TAG = "0034_aberrant_earthquake";

/**
 * Reads the committed migration journal + the 0034 SQL file. Injectable
 * for unit tests. Returns { tags: string[], has0034: boolean,
 * seedPresent: boolean }.
 */
export function readMigrationJournal({ readFileFn = readFileSync } = {}) {
  const journal = JSON.parse(readFileFn(`${MIGRATIONS_FOLDER}/meta/_journal.json`, "utf8"));
  const tags = (journal.entries ?? []).map((e) => e.tag);
  const has0034 = tags.includes(REQUIRED_MIGRATION_TAG);
  let seedPresent = false;
  if (has0034) {
    const sql = readFileFn(`${MIGRATIONS_FOLDER}/${REQUIRED_MIGRATION_TAG}.sql`, "utf8");
    // The hand-appended, replay-only seed — matched case-insensitively,
    // whitespace-tolerant. Its absence would mean `migrate()` replays the
    // schema but not the four staff roles.
    seedPresent = /insert\s+into\s+"?staff_roles"?/i.test(sql) && /on\s+conflict\s*\(\s*"?name"?\s*\)\s*do\s+nothing/i.test(sql);
  }
  return { tags, has0034, seedPresent };
}

function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  return { apply: has("--apply"), expectedDb: val("--expected-db"), dbUrl: val("--db-url") };
}

/**
 * Injectable core. Defaults are the real process-level equivalents; every
 * external effect (connect, migrate, prompt, journal read, logging) is a
 * parameter so unit tests never touch a real DB, spawn, or stdin.
 *
 *   connectFn(url)  -> { query(sql, params?) -> { rows }, drizzle -> <drizzle db>, end() }
 *   migrateFn(drizzleDb, { migrationsFolder }) -> Promise<void>
 */
export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  promptFn,
  log = console.log,
  error = console.error,
  connectFn,
  migrateFn,
  readJournalFn = readMigrationJournal,
} = {}) {
  const { apply, expectedDb, dbUrl } = parseArgs(argv);
  const testMode = env[TEST_MODE_ENV];
  const envMarker = env[PRODUCTION_ENV_MARKER_ENV];

  // ---- local journal inspection (always, no connection) --------------
  let journal;
  try {
    journal = readJournalFn();
  } catch (err) {
    error(`✗ REFUSED: cannot read the migration journal (${MIGRATIONS_FOLDER}/meta/_journal.json): ${err.message}`);
    return { ok: false, refused: true, mutated: false, reason: "journal unreadable" };
  }
  if (!journal.has0034) {
    error(`✗ REFUSED: migration "${REQUIRED_MIGRATION_TAG}" is not in the journal — nothing to do here.`);
    return { ok: false, refused: true, mutated: false, reason: "0034 missing from journal" };
  }
  if (!journal.seedPresent) {
    error(`✗ REFUSED: ${REQUIRED_MIGRATION_TAG}.sql does not contain the idempotent staff_roles seed — a replay would not seed roles. Do not proceed.`);
    return { ok: false, refused: true, mutated: false, reason: "0034 seed missing" };
  }

  log("─".repeat(64));
  log("PUBLIC-MAP — main-DB migration tool (drizzle-orm migrate() replay)");
  log("─".repeat(64));
  log(`  Migrations folder : ${MIGRATIONS_FOLDER}  (${journal.tags.length} in journal, latest: ${journal.tags[journal.tags.length - 1]})`);
  log(`  RBAC migration    : ${REQUIRED_MIGRATION_TAG} present, staff_roles seed present`);
  log(`  Mechanism         : drizzle-orm/node-postgres migrate()  —  NOT drizzle-kit push`);

  // ---- inspection mode: no connection, no mutation ------------------
  if (!apply) {
    log("  Mode              : INSPECTION (default) — no connection, no mutation");
    log("");
    log("  To apply for real: re-run with --apply, --expected-db <name>, and");
    log(`  ${PRODUCTION_ENV_MARKER_ENV}=production-main in the environment. You will be asked to type "${CONFIRMATION_TOKEN}".`);
    log("  See scripts/RBAC-BOOTSTRAP-PROCEDURE.md — this tool does not authorize production execution.");
    log("─".repeat(64));
    return { ok: true, mode: "inspection", mutated: false, migrations: journal.tags };
  }

  // ---- apply mode -------------------------------------------------
  const connectionString = testMode === "1" ? dbUrl : env.DATABASE_URL;
  if (!connectionString) {
    error(
      testMode === "1"
        ? "✗ REFUSED: --apply with RBAC_MIG_TEST_MODE=1 requires --db-url <127.0.0.1 url>."
        : "✗ REFUSED: --apply requires DATABASE_URL in the environment.",
    );
    return { ok: false, refused: true, mutated: false, reason: "no connection string" };
  }
  if (testMode !== "1" && !expectedDb) {
    error(`✗ REFUSED: --apply against a real target requires --expected-db <name> (the expected current_database()). It is never guessed.`);
    return { ok: false, refused: true, mutated: false, reason: "--expected-db missing" };
  }

  const connect = connectFn ?? (await defaultConnect());
  let conn;
  try {
    conn = await connect(connectionString);
  } catch (err) {
    error(`✗ REFUSED: could not connect to the target (details withheld): ${sanitizeError(err)}`);
    return { ok: false, refused: true, mutated: false, reason: "connect failed" };
  }

  try {
    const observed = (await conn.query("select current_database() as db")).rows?.[0]?.db;
    const decision = classifyTarget({ connectionString, expectedDbName: expectedDb, envMarker, testMode, observedDbName: observed });

    log(`  Target host       : ${decision.redacted.host}:${decision.redacted.port}`);
    log(`  Target database   : ${decision.redacted.database}  (current_database(): ${observed ?? "unknown"})`);
    log(`  Classification    : ${decision.classification}`);
    log(`  Reason            : ${decision.reason}`);

    if (decision.classification === "REFUSED") {
      error(`✗ REFUSED: ${decision.reason}. Nothing applied.`);
      return { ok: false, refused: true, mutated: false, classification: decision.classification, reason: decision.reason };
    }

    const ask =
      promptFn ??
      (async () => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const a = await rl.question(`Type "${CONFIRMATION_TOKEN}" to replay migrations against the target above, anything else to cancel: `);
        rl.close();
        return a;
      });
    const answer = await ask();
    if (String(answer).trim() !== CONFIRMATION_TOKEN) {
      log("Cancelled — no migrations replayed.");
      return { ok: true, cancelled: true, mutated: false, classification: decision.classification };
    }

    const doMigrate = migrateFn ?? (await defaultMigrate());
    log("Replaying migrations (single transaction)...");
    await doMigrate(conn.drizzle, { migrationsFolder: MIGRATIONS_FOLDER });

    // ---- post-verify ------------------------------------------------
    const roleRows = (await conn.query(`select name from staff_roles order by name`)).rows.map((r) => r.name);
    const tablesOk = (
      await conn.query(
        `select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('staff_roles','staff_members','staff_invitations')`,
      )
    ).rows[0].n;
    const staffMembers = (await conn.query(`select count(*)::int n from staff_members`)).rows[0].n;

    const seedExact = JSON.stringify(roleRows) === JSON.stringify(["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"]);
    log(`  staff_* tables    : ${tablesOk}/3`);
    log(`  staff_roles seed  : ${roleRows.join(", ")}  ${seedExact ? "✓ exact" : "✗ UNEXPECTED"}`);
    log(`  staff_members     : ${staffMembers} row(s)  (bootstrap is a SEPARATE tool — see RBAC-BOOTSTRAP-PROCEDURE.md)`);
    log("─".repeat(64));

    if (tablesOk !== 3 || !seedExact) {
      error("✗ Post-migration verification FAILED — inspect the target manually. (The migrate() transaction itself either committed or rolled back atomically.)");
      return { ok: false, mutated: true, verifyFailed: true, roleRows, tablesOk, classification: decision.classification };
    }
    return { ok: true, mutated: true, classification: decision.classification, roleRows, staffMembers };
  } finally {
    await conn.end?.().catch(() => {});
  }
}

function sanitizeError(err) {
  // Never echo a connection string that a pg error may embed.
  return String(err?.code ?? err?.message ?? err).replace(/postgres(ql)?:\/\/\S+/gi, "<redacted>");
}

async function defaultConnect() {
  const { Pool } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return async (connectionString) => {
    const pool = new Pool({ connectionString });
    await pool.query("select 1");
    return {
      query: (sql, params) => pool.query(sql, params),
      drizzle: drizzle(pool),
      end: () => pool.end(),
    };
  };
}

async function defaultMigrate() {
  const { migrate } = await import("drizzle-orm/node-postgres/migrator");
  return (drizzleDb, opts) => migrate(drizzleDb, opts);
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  loadDotenv({ path: ".env.local" });
  const result = await run();
  process.exit(result.ok ? 0 : 1);
}
