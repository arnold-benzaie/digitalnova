#!/usr/bin/env node
/**
 * PHASE RBAC-MIG-TOOLING + CRM-MIGRATOR-HARDENING-1 + -2 — reviewed
 * main-DB migration tool.
 *
 * ⚠ TOOLING ONLY. This script DOES NOT authorize production execution.
 *   A real protected-DB apply requires SEPARATE human authorization,
 *   `--apply`, the typed token "MIGRATE", all production signals (see
 *   scripts/lib/protected-db-target.mjs), an operator-supplied
 *   `--expected-db`, an operator-supplied `--expected-pending` set that
 *   must EXACTLY equal the target's actual pending migrations, and an
 *   operator/reviewer-supplied `--expected-fingerprint` that must match
 *   the selected migrations folder. See scripts/RBAC-BOOTSTRAP-PROCEDURE.md.
 *
 * Replays a migrations folder against the MAIN PUBLIC-MAP database via
 * drizzle-orm's migrate() REPLAY (drizzle-orm/node-postgres/migrator) —
 * NOT `drizzle-kit push`. `push` diffs the live schema and would NOT run
 * hand-appended seed statements (e.g. migration 0034's
 * `INSERT INTO "staff_roles"`). migrate() replays each migration file in
 * the SELECTED folder, statement-by-statement, in one Postgres
 * transaction (drizzle-orm 0.45.2, pg-core dialect): a failure rolls back
 * atomically and a completed migration is a no-op on re-run.
 *
 * ─────────────────────────────────────────────────────────────────────
 * WHY --migrations-folder, --expected-pending AND --expected-fingerprint
 * ARE SECURITY CONTROLS
 * ─────────────────────────────────────────────────────────────────────
 * drizzle's migrate() applies EVERY journal entry whose `when` is greater
 * than the single latest `created_at` recorded in
 * drizzle.__drizzle_migrations. It cannot stop early, cannot skip, and
 * does NOT verify that the recorded rows form a clean prefix, nor that
 * the .sql it is about to run matches anything trusted — it only looks at
 * MAX(created_at). So:
 *   - --migrations-folder is the CEILING of what can be applied, and (for
 *     a PRODUCTION-MAIN apply) it must canonically resolve INSIDE the
 *     trusted <repo>/db/ artifact boundary — no /tmp, home-dir, symlink,
 *     or `..` escape.
 *   - --expected-pending is the operator's explicit, ordered statement of
 *     which migrations this window may apply; the tool refuses to mutate
 *     unless the target's ACTUAL pending set (selected journal minus a
 *     verified exact clean contiguous prefix) is byte-for-byte equal to
 *     it, in order.
 *   - --expected-fingerprint is a reviewer/operator-supplied SHA-256 of
 *     the selected folder's content. It is NOT self-derived: the tool
 *     only COMPARES it to the folder's deterministic fingerprint, before
 *     connecting AND again immediately before migrate(). Mismatch,
 *     missing (production), or malformed → refuse before connection.
 *   - --acknowledge-prefix-hash-drift is required (production) if any
 *     already-applied prefix row's recorded hash differs from this
 *     folder's .sql; without it, drift → refuse before MIGRATE.
 *
 * ─────────────────────────────────────────────────────────────────────
 * DEFAULT MODE = INSPECTION: resolves + validates the folder + journal,
 * parses + locally validates --expected-pending, prints the folder
 * fingerprint (so a reviewer can capture it out of band), opens NO
 * connection, performs ZERO mutation. migrate() is NEVER called without
 * `--apply`.
 *
 * REAL APPLY (`--apply`), in order:
 *   1. initial local artifact validation (folder resolve + journal
 *      structure + expected-pending local validation + fingerprint parse)
 *   2. STATIC PRE-CONNECTION GATE (no connection): production requires the
 *      trusted-folder boundary + looksLikeMainProduction(DATABASE_URL) +
 *      --expected-db + --expected-pending + --expected-fingerprint MATCH;
 *      test mode requires host === 127.0.0.1 + no production signature.
 *      Any failure → ZERO connections.
 *   3. FIRST READ-ONLY PREFLIGHT: BEGIN READ ONLY → current_database() →
 *      classifyTarget() → read drizzle.__drizzle_migrations → exact clean
 *      contiguous prefix check → observed pending set → ROLLBACK.
 *   4. EXACT AUTHORIZATION GATE: observed pending === --expected-pending.
 *   5. MUTATION PLAN (+ prefix-hash-drift detail) + prefix-hash-drift
 *      acknowledgement gate + typed "MIGRATE".
 *   6. SECOND READ-ONLY PREFLIGHT (DB change-window recheck).
 *   7. ARTIFACT RE-CHECK: re-read the journal + every .sql; require the
 *      recomputed fingerprint === the initial one === --expected-fingerprint
 *      and the journal identity (idx/tag/when) unchanged.
 *   8. migrate() against the SELECTED folder.
 *   9. POST-VERIFY: recorded rows + per-migration structural verifiers
 *      (registry keyed by tag; unknown tags get metadata verification only).
 *
 * Residual DB race (NOT eliminated, and NOT "bounded to fewer"): between
 * step 7's ROLLBACK and drizzle's own internal
 * `select … order by created_at desc limit 1` at the start of migrate(),
 * a different connection could still write to drizzle.__drizzle_migrations.
 *   - If it INSERTs a NEWER metadata row, drizzle runs fewer pending
 *     migrations, or none (post-verify's recorded-row-count check fails).
 *   - If it DELETEs / TRUNCATEs / rewinds drizzle.__drizzle_migrations,
 *     drizzle's `!lastDbMigration` branch makes it ATTEMPT to replay
 *     EARLIER migrations from the SELECTED journal — potentially the whole
 *     selected journal, not just the authorised pending set.
 * For the currently reviewed populated PUBLIC-MAP schema and the
 * historical 0000..0033 migration set, that replay attempt re-issues
 * non-idempotent historical DDL (bare CREATE TABLE / CREATE INDEX, no
 * IF NOT EXISTS), so the drizzle migrate() transaction fails and rolls
 * back atomically and run() reports migrationFailed — this reviewed case
 * therefore does NOT establish an unauthorised committed-SQL path. That
 * conclusion is SPECIFIC to this schema + migration set and does NOT
 * generalise to arbitrary future migration histories. The earlier
 * "can only cause FEWER entries" claim is false.
 * Mitigation is PROCEDURAL, not cryptographic: the production migration
 * MUST run in an exclusive controlled window in which no other process or
 * operator may, against the target DB, write migration metadata
 * (INSERT/UPDATE/DELETE/TRUNCATE), execute schema DDL, or run another
 * migration process. That removes the concurrent actor; it does NOT
 * eliminate the race, and the residual race is NOT fully eliminated.
 * Single-Client removes only the same-connection interleave, not this
 * cross-connection window.
 *
 * Never prints DATABASE_URL, credentials, tokens, or migration SQL.
 *
 * Usage:
 *   npx tsx scripts/db-migrate.mjs
 *   npx tsx scripts/db-migrate.mjs --migrations-folder <path> --expected-pending 0031_x,0032_y
 *   RBAC_BOOTSTRAP_TARGET=production-main npx tsx scripts/db-migrate.mjs \
 *       --apply --migrations-folder <trusted-pinned-path> \
 *       --expected-pending 0031_stiff_leech,0032_cool_red_wolf,0033_reflective_wolf_cub \
 *       --expected-fingerprint <sha256-from-reviewer> --expected-db <name>
 *   RBAC_MIG_TEST_MODE=1 npx tsx scripts/db-migrate.mjs --apply --db-url <127.0.0.1 url>
 */
import { config as loadDotenv } from "dotenv";
import { readFileSync, realpathSync } from "node:fs";
import { createHash } from "node:crypto";
import { createInterface } from "node:readline/promises";
import { resolve as pathResolve, isAbsolute, sep as pathSep, dirname } from "node:path";
import { fileURLToPath } from "node:url";
import {
  classifyTarget,
  PRODUCTION_ENV_MARKER_ENV,
  TEST_MODE_ENV,
} from "./lib/protected-db-target.mjs";
import { looksLikeMainProduction } from "../db/guard-main-production.ts";

export const CONFIRMATION_TOKEN = "MIGRATE";
export const DEFAULT_MIGRATIONS_FOLDER = "db/migrations";
/**
 * The RBAC workforce migration. NOT required to be present — the migrator
 * is generic — but WHEN present in the selected journal AND in the
 * pending set, its hand-appended idempotent `staff_roles` seed is
 * integrity-checked and its structural verifier runs.
 */
export const RBAC_SEED_MIGRATION_TAG = "0034_aberrant_earthquake";

const MIGRATIONS_SCHEMA = "drizzle";
const MIGRATIONS_TABLE = "__drizzle_migrations";
export const PREFIX_HASH_DRIFT_FLAG = "--acknowledge-prefix-hash-drift";

// <repo>/app  (this file is <repo>/app/scripts/db-migrate.mjs)
const REPO_ROOT = dirname(dirname(fileURLToPath(import.meta.url)));
/** Trusted boundary for a PRODUCTION-MAIN --migrations-folder. */
export const TRUSTED_PRODUCTION_MIGRATION_ROOT = pathResolve(REPO_ROOT, "db");

// ─────────────────────────────────────────────────────────────────────
// Pure helpers (all exported for unit tests — no I/O unless a fn is injected)
// ─────────────────────────────────────────────────────────────────────

function parseArgs(argv) {
  // An explicitly present value-flag whose next token is missing or is
  // itself a `--flag` is recorded as malformed → run() refuses loudly
  // (never a silent fall-back to a default).
  const malformed = [];
  const val = (f) => {
    const i = argv.indexOf(f);
    if (i < 0) return undefined;
    const next = argv[i + 1];
    if (next === undefined || next.startsWith("--")) {
      malformed.push(f);
      return undefined;
    }
    return next;
  };
  const expectedDb = val("--expected-db");
  const dbUrl = val("--db-url");
  const migrationsFolder = val("--migrations-folder");
  const expectedPendingRaw = val("--expected-pending");
  const expectedFingerprintRaw = val("--expected-fingerprint");
  return {
    apply: argv.includes("--apply"),
    acknowledgePrefixHashDrift: argv.includes(PREFIX_HASH_DRIFT_FLAG),
    expectedDb,
    dbUrl,
    migrationsFolder,
    expectedPendingRaw,
    expectedFingerprintRaw,
    malformed,
  };
}

/**
 * Resolve the migrations folder path. Default is `db/migrations` (relative
 * to CWD, the repo root — the same string drizzle's migrate() receives).
 * Rejects a non-string / empty / NUL-bearing path. Existence and the
 * PRODUCTION-MAIN trusted-boundary are enforced elsewhere.
 */
export function resolveMigrationsFolder(folder) {
  if (folder === undefined) return { ok: true, folder: DEFAULT_MIGRATIONS_FOLDER };
  if (typeof folder !== "string" || folder.trim() === "") {
    return { ok: false, error: "--migrations-folder requires a non-empty path" };
  }
  if (folder.includes("\0")) {
    return { ok: false, error: "--migrations-folder contains an illegal NUL byte" };
  }
  return { ok: true, folder };
}

const defaultRealpath = realpathSync;

/**
 * FINDING A / trusted-folder boundary (PRODUCTION-MAIN only). Canonically
 * resolves the selected folder and the trusted root (following symlinks,
 * symlinked parents, and `..`) and requires containment. `realpathFn` and
 * `repoRoot` are injectable for unit tests.
 * Returns { ok, canonicalFolder } | { ok:false, error }.
 */
export function assertTrustedProductionFolder({
  folder,
  realpathFn = defaultRealpath,
  repoRoot = REPO_ROOT,
} = {}) {
  const trustedRoot = pathResolve(repoRoot, "db");
  let canonRoot;
  try {
    canonRoot = realpathFn(trustedRoot);
  } catch (err) {
    return { ok: false, error: `trusted migration root ${trustedRoot} is not resolvable: ${err.message}` };
  }
  const abs = isAbsolute(folder) ? folder : pathResolve(process.cwd(), folder);
  let canonFolder;
  try {
    canonFolder = realpathFn(abs);
  } catch (err) {
    return { ok: false, error: `--migrations-folder does not resolve to a real path: ${err.message}` };
  }
  const inside = canonFolder === canonRoot || canonFolder.startsWith(canonRoot + pathSep);
  if (!inside) {
    return {
      ok: false,
      error:
        `--migrations-folder (canonical: ${canonFolder}) is OUTSIDE the trusted production migration ` +
        `boundary (${canonRoot}). A reviewed pinned repair artifact must live inside <repo>/db/.`,
    };
  }
  return { ok: true, canonicalFolder: canonFolder };
}

/**
 * Reads + fully validates a migrations folder's journal and every .sql it
 * references. `readFileFn` is injectable for unit tests. Throws Error with
 * a specific message on ANY structural problem. Returns:
 *   { folder, entries: [{ idx, tag, when, sql, hash, sqlPath }] (idx-ordered),
 *     tags: string[], fingerprint: string, identity: string,
 *     rbacSeedMigrationPresent: boolean, rbacSeedOk: boolean | null }
 */
export function readMigrationJournal({ folder = DEFAULT_MIGRATIONS_FOLDER, readFileFn = readFileSync } = {}) {
  const journalPath = `${folder}/meta/_journal.json`;
  let parsed;
  try {
    parsed = JSON.parse(readFileFn(journalPath, "utf8"));
  } catch (err) {
    throw new Error(`cannot read/parse ${journalPath}: ${err.message}`);
  }

  const rawEntries = parsed?.entries;
  if (!Array.isArray(rawEntries) || rawEntries.length === 0) {
    throw new Error(`${journalPath}: "entries" is missing or empty`);
  }

  const entries = rawEntries.map((e, n) => {
    if (!e || typeof e !== "object") throw new Error(`${journalPath}: entry #${n + 1} is not an object`);
    const { idx, tag, when } = e;
    if (!Number.isInteger(idx) || idx < 0) {
      throw new Error(`${journalPath}: entry "${String(tag ?? n)}" has a non-integer/negative idx`);
    }
    if (typeof tag !== "string" || tag.trim() === "") {
      throw new Error(`${journalPath}: entry idx=${idx} has an empty tag`);
    }
    if (typeof when !== "number" || !Number.isFinite(when)) {
      throw new Error(`${journalPath}: entry "${tag}" has a non-numeric "when"`);
    }
    return { idx, tag, when };
  });

  entries.sort((a, b) => a.idx - b.idx);
  entries.forEach((e, i) => {
    if (e.idx !== i) {
      throw new Error(`${journalPath}: idx sequence is not contiguous from 0 (expected ${i}, got ${e.idx} at "${e.tag}")`);
    }
  });

  const seenTag = new Set();
  for (const e of entries) {
    if (seenTag.has(e.tag)) throw new Error(`${journalPath}: duplicate tag "${e.tag}"`);
    seenTag.add(e.tag);
  }

  for (let i = 1; i < entries.length; i++) {
    if (!(entries[i].when > entries[i - 1].when)) {
      throw new Error(
        `${journalPath}: "when" values are not strictly increasing ` +
          `("${entries[i - 1].tag}"=${entries[i - 1].when} → "${entries[i].tag}"=${entries[i].when})`,
      );
    }
  }

  for (const e of entries) {
    const sqlPath = `${folder}/${e.tag}.sql`;
    let text;
    try {
      text = readFileFn(sqlPath, "utf8");
    } catch (err) {
      throw new Error(`${sqlPath}: referenced by the journal but not readable (${err.message})`);
    }
    e.sql = typeof text === "string" ? text : String(text);
    // Same digest drizzle-orm's readMigrationFiles() records: sha256 of the
    // full .sql file text, hex.
    e.hash = createHash("sha256").update(e.sql).digest("hex");
    e.sqlPath = sqlPath;
  }

  const tags = entries.map((e) => e.tag);
  const fingerprint = createHash("sha256").update(entries.map((e) => e.hash).join("\n")).digest("hex");
  // Covers what `fingerprint` does not: tag identity, order, idx and `when`.
  const identity = entries.map((e) => `${e.idx}:${e.tag}:${e.when}`).join("|");

  const rbacIdx = tags.indexOf(RBAC_SEED_MIGRATION_TAG);
  let rbacSeedOk = null;
  if (rbacIdx >= 0) {
    const sql = entries[rbacIdx].sql;
    rbacSeedOk =
      /insert\s+into\s+"?staff_roles"?/i.test(sql) &&
      /on\s+conflict\s*\(\s*"?name"?\s*\)\s*do\s+nothing/i.test(sql);
  }

  return {
    folder,
    entries,
    tags,
    fingerprint,
    identity,
    rbacSeedMigrationPresent: rbacIdx >= 0,
    rbacSeedOk,
  };
}

/**
 * FINDING A. Parse `--expected-fingerprint`: exactly 64 hex chars, case
 * insensitive, normalised to lowercase. Returns { ok, value } | { ok:false, error }.
 */
export function parseExpectedFingerprint(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, error: "--expected-fingerprint not supplied" };
  }
  const v = String(raw).trim();
  if (!/^[0-9a-fA-F]{64}$/.test(v)) {
    return { ok: false, error: `--expected-fingerprint must be a 64-hex-character SHA-256 (got "${v.slice(0, 16)}…", ${v.length} chars)` };
  }
  return { ok: true, value: v.toLowerCase() };
}

/**
 * Parse `--expected-pending`. Only surrounding whitespace is normalised;
 * order is preserved verbatim. Rejects an empty list, an empty tag, and
 * duplicates. Returns { ok, tags } | { ok:false, error }.
 */
export function parseExpectedPending(raw) {
  if (raw === undefined || raw === null) {
    return { ok: false, error: "--expected-pending not supplied" };
  }
  const tags = String(raw).split(",").map((s) => s.trim());
  if (tags.length === 0) return { ok: false, error: "--expected-pending is empty" };
  if (tags.some((t) => t === "")) return { ok: false, error: "--expected-pending contains an empty tag" };
  const dup = tags.find((t, i) => tags.indexOf(t) !== i);
  if (dup) return { ok: false, error: `--expected-pending contains a duplicate tag: "${dup}"` };
  return { ok: true, tags };
}

/**
 * Local (pre-connection) validation of --expected-pending against the
 * selected journal. Because migrate() always applies every journal entry
 * after the last-applied one, an authorised pending set can only ever be
 * the journal's trailing, contiguous, in-order slice. Also refuses a set
 * that spans the whole journal. Returns { ok } | { ok:false, error }.
 */
export function validateExpectedPendingLocally(expectedTags, journalTags) {
  for (const t of expectedTags) {
    if (!journalTags.includes(t)) {
      return { ok: false, error: `--expected-pending tag "${t}" is not in the selected migration journal` };
    }
  }
  if (expectedTags.length > journalTags.length) {
    return { ok: false, error: "--expected-pending has more tags than the selected journal" };
  }
  const suffix = journalTags.slice(journalTags.length - expectedTags.length);
  const ordered = expectedTags.every((t, i) => t === suffix[i]);
  if (!ordered) {
    return {
      ok: false,
      error:
        `--expected-pending must be the trailing, contiguous, in-order slice of the selected ` +
        `journal (its last ${expectedTags.length}: [${suffix.join(", ")}]). A migrate() replay ` +
        `always applies every journal entry after the last-applied one — it cannot stop early or skip. ` +
        `If the selected folder's journal contains migrations you are not authorised to apply in this ` +
        `window, point --migrations-folder at a reviewed folder whose journal ends at the last one in scope.`,
    };
  }
  if (expectedTags.length === journalTags.length) {
    return {
      ok: false,
      error:
        "--expected-pending equals the entire selected journal — this tool requires a non-empty, " +
        "already-applied clean prefix on the target (an empty metadata table is refused for a protected apply).",
    };
  }
  return { ok: true };
}

/**
 * Verify the rows read from drizzle.__drizzle_migrations are an EXACT
 * clean contiguous prefix of the selected journal (by `created_at` ===
 * journal `when`, position by position) and compute the ordered pending
 * tags. Hash divergence on the prefix is reported (hashMismatchCount /
 * hashMismatches) but is NOT decided here — the caller applies the
 * acknowledgement policy. The created_at prefix check is always
 * authoritative and independent of hash.
 *
 * Returns { ok, prefixLen, pendingTags, hashMismatchCount, hashMismatches }
 *       | { ok:false, error }.
 */
export function computeCleanPrefixAndPending({ journal, recordedRows, allowEmptyPrefix = false }) {
  const entries = journal.entries;
  const rows = (recordedRows ?? []).map((r) => ({
    hash: r.hash == null ? null : String(r.hash),
    createdAt: Number(r.created_at ?? r.createdAt),
  }));

  if (rows.some((r) => !Number.isFinite(r.createdAt))) {
    return { ok: false, error: "drizzle.__drizzle_migrations has a row with a non-numeric created_at" };
  }
  if (rows.length === 0) {
    if (allowEmptyPrefix) {
      return { ok: true, prefixLen: 0, pendingTags: journal.tags.slice(), hashMismatchCount: 0, hashMismatches: [] };
    }
    return {
      ok: false,
      error:
        "drizzle.__drizzle_migrations is empty or absent — refused for a protected apply (no established clean prefix)",
    };
  }

  rows.sort((a, b) => a.createdAt - b.createdAt);
  for (let i = 1; i < rows.length; i++) {
    if (rows[i].createdAt === rows[i - 1].createdAt) {
      return { ok: false, error: `drizzle.__drizzle_migrations has a duplicate/ambiguous created_at: ${rows[i].createdAt}` };
    }
  }
  if (rows.length > entries.length) {
    return {
      ok: false,
      error:
        `drizzle.__drizzle_migrations has ${rows.length} rows but the selected journal only has ` +
        `${entries.length} entries — the target is ahead of the selected migrations folder`,
    };
  }

  const hashMismatches = [];
  for (let i = 0; i < rows.length; i++) {
    if (rows[i].createdAt !== entries[i].when) {
      return {
        ok: false,
        error:
          `drizzle.__drizzle_migrations is not a clean contiguous prefix of the selected journal: ` +
          `recorded row #${i + 1} created_at=${rows[i].createdAt}, but journal entry #${i + 1} ("${entries[i].tag}") ` +
          `has when=${entries[i].when}. Refusing (missing interior migration, out-of-order metadata, ` +
          `unknown created_at, or wrong migrations folder).`,
      };
    }
    if (rows[i].hash && entries[i].hash && rows[i].hash !== entries[i].hash) {
      hashMismatches.push({
        tag: entries[i].tag,
        recorded: rows[i].hash.slice(0, 12),
        local: entries[i].hash.slice(0, 12),
      });
    }
  }

  return {
    ok: true,
    prefixLen: rows.length,
    pendingTags: journal.tags.slice(rows.length),
    hashMismatchCount: hashMismatches.length,
    hashMismatches,
  };
}

/** Exact, ordered equality. Tags are public migration names — safe to print. */
export function assertExpectedEqualsObserved(expected, observed) {
  const a = expected ?? [];
  const b = observed ?? [];
  const equal = a.length === b.length && a.every((t, i) => t === b[i]);
  if (equal) return { ok: true };
  return {
    ok: false,
    error:
      `--expected-pending [${a.join(", ")}] does not equal the target's actual pending set ` +
      `[${b.join(", ")}] — refusing before any mutation`,
  };
}

/**
 * STATIC pre-connection gate. Pure. Runs BEFORE any connection. All
 * inputs are local. The trusted-folder boundary and the
 * --expected-fingerprint MATCH are checked by run() alongside this (they
 * need FS realpath / the journal fingerprint). Returns { ok, mode } | { ok:false, error }.
 */
export function staticPreConnectionGate({ connectionString, testMode, expectedDb, expectedPending, journal }) {
  let host;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return { ok: false, error: "connection string is not a valid URL" };
  }
  const signature = looksLikeMainProduction(connectionString);

  if (testMode) {
    if (host !== "127.0.0.1") {
      return { ok: false, error: `${TEST_MODE_ENV}=1 requires host exactly 127.0.0.1 (got "${host}")` };
    }
    if (signature) {
      return { ok: false, error: "connection string carries the main-production signature — it cannot be a disposable test target" };
    }
    return { ok: true, mode: "TEST-DISPOSABLE" };
  }

  // production mode
  if (!signature) {
    return { ok: false, error: "connection string does not match looksLikeMainProduction() — refusing to connect in production mode" };
  }
  if (!expectedDb) {
    return { ok: false, error: "--expected-db <name> is required for a production apply (it is never guessed)" };
  }
  if (!expectedPending || expectedPending.length === 0) {
    return { ok: false, error: "--expected-pending <t1,t2,...> is required for a production apply" };
  }
  if (
    journal.rbacSeedMigrationPresent &&
    expectedPending.includes(RBAC_SEED_MIGRATION_TAG) &&
    !journal.rbacSeedOk
  ) {
    return {
      ok: false,
      error: `${RBAC_SEED_MIGRATION_TAG} is in the pending set but its .sql is missing the idempotent staff_roles seed — a replay would not seed roles`,
    };
  }
  return { ok: true, mode: "PRODUCTION-MAIN" };
}

// ─────────────────────────────────────────────────────────────────────
// FINDING E — per-migration structural post-verifiers.
// Registry keyed by migration tag. Each verifier is READ-ONLY (SELECT /
// catalog introspection only — no CREATE/ALTER/INSERT/UPDATE/DELETE) and
// returns { ok: boolean, detail: string } (0034 additionally returns
// { rbac } for back-compat). Assertions are derived directly from the
// committed migration .sql. A migration with NO registered verifier gets
// metadata verification only.
// ─────────────────────────────────────────────────────────────────────
export const STRUCTURAL_VERIFIERS = {
  // 0031: CREATE TABLE crm_quote_access_links (8 cols) + FK -> crm_quotes
  //       + crm_quote_access_links_quote_id_idx + UNIQUE crm_quote_access_links_token_idx
  "0031_stiff_leech": async (conn) => {
    const r = (
      await conn.query(`
        select
          (to_regclass('public.crm_quote_access_links') is not null) as tbl,
          (select count(*) from information_schema.columns
             where table_schema='public' and table_name='crm_quote_access_links'
               and column_name in ('id','quote_id','token','expires_at','revoked_at','failed_attempts','max_attempts','created_at'))::int as link_cols,
          (select count(*) from pg_indexes
             where schemaname='public' and tablename='crm_quote_access_links'
               and indexname in ('crm_quote_access_links_quote_id_idx','crm_quote_access_links_token_idx'))::int as link_idx,
          (select count(*) from information_schema.table_constraints
             where table_schema='public' and table_name='crm_quote_access_links'
               and constraint_type='FOREIGN KEY'
               and constraint_name='crm_quote_access_links_quote_id_crm_quotes_id_fk')::int as link_fk
      `)
    ).rows[0];
    const ok = r.tbl === true && r.link_cols === 8 && r.link_idx === 2 && r.link_fk === 1;
    return { ok, detail: `crm_quote_access_links: table=${r.tbl} cols=${r.link_cols}/8 indexes=${r.link_idx}/2 fk=${r.link_fk}/1` };
  },
  // 0032: crm_clients ADD industry, do_not_contact (NOT NULL DEFAULT false),
  //       do_not_contact_reason + crm_clients_industry_idx
  "0032_cool_red_wolf": async (conn) => {
    const r = (
      await conn.query(`
        select
          (select count(*) from information_schema.columns
             where table_schema='public' and table_name='crm_clients'
               and column_name in ('industry','do_not_contact','do_not_contact_reason'))::int as client_cols,
          (select count(*) from information_schema.columns
             where table_schema='public' and table_name='crm_clients'
               and column_name='do_not_contact' and is_nullable='NO' and column_default like 'false%')::int as dnc_notnull,
          (select count(*) from pg_indexes
             where schemaname='public' and tablename='crm_clients' and indexname='crm_clients_industry_idx')::int as client_idx
      `)
    ).rows[0];
    const ok = r.client_cols === 3 && r.dnc_notnull === 1 && r.client_idx === 1;
    return { ok, detail: `crm_clients: cols=${r.client_cols}/3 do_not_contact(NOT NULL DEFAULT false)=${r.dnc_notnull}/1 index=${r.client_idx}/1` };
  },
  // 0033: interactions ADD direction, outcome (both text, nullable)
  "0033_reflective_wolf_cub": async (conn) => {
    const r = (
      await conn.query(`
        select (select count(*) from information_schema.columns
           where table_schema='public' and table_name='interactions'
             and column_name in ('direction','outcome'))::int as interaction_cols
      `)
    ).rows[0];
    const ok = r.interaction_cols === 2;
    return { ok, detail: `interactions: direction/outcome cols=${r.interaction_cols}/2` };
  },
  // 0034 (RBAC): three staff_* tables + exact staff_roles seed. Unchanged
  // assertions from CRM-MIGRATOR-HARDENING-1's inline postVerify.
  "0034_aberrant_earthquake": async (conn) => {
    const roleRows = (await conn.query("select name from staff_roles order by name")).rows.map((x) => x.name);
    const tablesOk = (
      await conn.query(
        `select count(*)::int n from information_schema.tables where table_schema='public' and table_name in ('staff_roles','staff_members','staff_invitations')`,
      )
    ).rows[0].n;
    const seedExact = JSON.stringify(roleRows) === JSON.stringify(["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"]);
    return {
      ok: seedExact && tablesOk === 3,
      detail: `staff_* tables=${tablesOk}/3 staff_roles seed=[${roleRows.join(",")}] ${seedExact ? "exact" : "UNEXPECTED"}`,
      rbac: { roleRows, tablesOk, seedExact },
    };
  },
};

// ─────────────────────────────────────────────────────────────────────
// Read-only preflight (one connection, BEGIN READ ONLY … ROLLBACK)
// ─────────────────────────────────────────────────────────────────────

async function readOnlyPreflight(conn, { journal, expectedDb, connectionString, envMarker, testMode }) {
  await conn.query("BEGIN READ ONLY");
  try {
    const observed = (await conn.query("select current_database() as db")).rows?.[0]?.db;
    const decision = classifyTarget({
      connectionString,
      expectedDbName: expectedDb,
      envMarker,
      testMode: testMode ? "1" : undefined,
      observedDbName: observed,
    });
    const base = {
      observed,
      redacted: decision.redacted,
      classification: decision.classification,
      classificationReason: decision.reason,
    };
    if (decision.classification === "REFUSED") {
      return { ...base, ok: false, error: decision.reason };
    }

    const reg = (
      await conn.query(`select to_regclass('${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE}') as reg`)
    ).rows?.[0]?.reg;

    let recordedRows = [];
    if (reg == null) {
      if (decision.classification === "PRODUCTION-MAIN") {
        return {
          ...base,
          ok: false,
          error:
            `${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} does not exist on the target — refused for a production ` +
            `apply (no established clean prefix; not created during preflight)`,
        };
      }
    } else {
      recordedRows =
        (await conn.query(
          `select id, hash, created_at from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by created_at asc`,
        )).rows ?? [];
    }

    const cp = computeCleanPrefixAndPending({
      journal,
      recordedRows,
      allowEmptyPrefix: decision.classification === "TEST-DISPOSABLE",
    });
    if (!cp.ok) return { ...base, ok: false, error: cp.error };

    return {
      ...base,
      ok: true,
      prefixLen: cp.prefixLen,
      observedPending: cp.pendingTags,
      hashMismatchCount: cp.hashMismatchCount ?? 0,
      hashMismatches: cp.hashMismatches ?? [],
    };
  } finally {
    await conn.query("ROLLBACK").catch(() => {});
  }
}

async function postVerify(conn, { journal, prefixLen, appliedPending }) {
  const rows =
    (await conn.query(
      `select created_at from ${MIGRATIONS_SCHEMA}.${MIGRATIONS_TABLE} order by created_at asc`,
    )).rows ?? [];
  const recordedCount = rows.length;
  const expectedCount = prefixLen + appliedPending.length;
  const latestWhen = rows.length ? Number(rows[rows.length - 1].created_at) : null;
  const expectLatestWhen = journal.entries[expectedCount - 1]?.when ?? null;

  const result = {
    ok: recordedCount === expectedCount && latestWhen === expectLatestWhen,
    recordedCount,
    expectedCount,
    latestTag: journal.tags[recordedCount - 1] ?? "(none)",
    structural: [],
  };

  for (const tag of appliedPending) {
    const verifier = STRUCTURAL_VERIFIERS[tag];
    if (!verifier) continue; // unknown migration → metadata verification only
    const r = await verifier(conn);
    result.structural.push({ tag, ok: r.ok, detail: r.detail });
    if (r.rbac) result.rbac = r.rbac; // back-compat: run() returns roleRows
    if (!r.ok) result.ok = false;
  }
  return result;
}

// ─────────────────────────────────────────────────────────────────────
// Orchestration
// ─────────────────────────────────────────────────────────────────────

/**
 * Injectable core. Every external effect (connect, migrate, prompt,
 * journal read, realpath, logging) is a parameter so unit tests never
 * touch a real DB, spawn, stdin, or the real filesystem layout.
 *
 *   connectFn(url) -> { query(sql, params?) -> { rows }, drizzle, end() }
 *   migrateFn(drizzleDb, { migrationsFolder }) -> Promise<void>
 *   readJournalFn({ folder }) -> journal      (called AGAIN just before migrate())
 *   realpathFn(path) -> canonical path        (PRODUCTION-MAIN folder trust)
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
  realpathFn,
} = {}) {
  const {
    apply,
    acknowledgePrefixHashDrift,
    expectedDb,
    dbUrl,
    migrationsFolder,
    expectedPendingRaw,
    expectedFingerprintRaw,
    malformed,
  } = parseArgs(argv);
  const testMode = env[TEST_MODE_ENV] === "1";
  const envMarker = env[PRODUCTION_ENV_MARKER_ENV];

  // ---- FINDING 8: an explicitly present flag with no value fails loudly.
  if (malformed.length) {
    const msg = `flag(s) present without a value: ${malformed.join(", ")}`;
    error(`✗ REFUSED: ${msg}`);
    return { ok: false, refused: true, mutated: false, reason: msg };
  }

  // ---- initial local artifact validation (no connection) ----------
  const selected = resolveMigrationsFolder(migrationsFolder);
  if (!selected.ok) {
    error(`✗ REFUSED: ${selected.error}`);
    return { ok: false, refused: true, mutated: false, reason: selected.error };
  }
  let journal;
  try {
    journal = readJournalFn({ folder: selected.folder });
  } catch (err) {
    error(`✗ REFUSED: invalid migration journal (${selected.folder}): ${sanitizeError(err)}`);
    return { ok: false, refused: true, mutated: false, reason: "journal invalid" };
  }

  let expectedPending = null;
  if (expectedPendingRaw !== undefined) {
    const p = parseExpectedPending(expectedPendingRaw);
    if (!p.ok) {
      error(`✗ REFUSED: ${p.error}`);
      return { ok: false, refused: true, mutated: false, reason: p.error };
    }
    const v = validateExpectedPendingLocally(p.tags, journal.tags);
    if (!v.ok) {
      error(`✗ REFUSED: ${v.error}`);
      return { ok: false, refused: true, mutated: false, reason: v.error };
    }
    expectedPending = p.tags;
  }

  let expectedFingerprint = null;
  if (expectedFingerprintRaw !== undefined) {
    const f = parseExpectedFingerprint(expectedFingerprintRaw);
    if (!f.ok) {
      error(`✗ REFUSED: ${f.error}`);
      return { ok: false, refused: true, mutated: false, reason: f.error };
    }
    expectedFingerprint = f.value;
  }

  // ---- banner -----------------------------------------------------
  log("─".repeat(64));
  log("PUBLIC-MAP — main-DB migration tool (drizzle-orm migrate() replay)");
  log("─".repeat(64));
  log(`  Migrations folder  : ${selected.folder}`);
  log(`  Journal            : ${journal.tags.length} entries, latest "${journal.tags[journal.tags.length - 1]}"`);
  log(`  Folder fingerprint : ${journal.fingerprint}`);
  log(`  Mechanism          : drizzle-orm/node-postgres migrate()  —  NOT drizzle-kit push`);
  if (journal.rbacSeedMigrationPresent) {
    log(`  RBAC seed check    : ${RBAC_SEED_MIGRATION_TAG} in journal — staff_roles seed ${journal.rbacSeedOk ? "present ✓" : "MISSING ✗"}`);
  }
  if (expectedPending) {
    log(`  Expected pending   : [${expectedPending.join(", ")}]  (locally validated as the journal's trailing slice)`);
  }
  if (expectedFingerprint) {
    log(`  Expected fingerprint: ${expectedFingerprint}  ${expectedFingerprint === journal.fingerprint ? "✓ matches folder" : "✗ MISMATCH"}`);
  }

  // ---- inspection mode: no connection, no mutation ----------------
  if (!apply) {
    log(`  Mode               : INSPECTION (default) — no connection, no mutation`);
    log(`  Reviewer: capture the "Folder fingerprint" above and pass it back as --expected-fingerprint`);
    log(`  for the authorised --apply. It is NOT self-derived at apply time — it is compared, twice.`);
    log(`  To apply           : --apply --migrations-folder <trusted path> --expected-pending <t1,..> \\`);
    log(`                       --expected-fingerprint <sha256> --expected-db <name>  (${PRODUCTION_ENV_MARKER_ENV}=production-main)`);
    log("─".repeat(64));
    return {
      ok: true,
      mode: "inspection",
      mutated: false,
      migrations: journal.tags,
      selectedFolder: selected.folder,
      fingerprint: journal.fingerprint,
      expectedPending,
    };
  }

  // ---- connection string ----------------------------------------
  const connectionString = testMode ? dbUrl : env.DATABASE_URL;
  if (!connectionString) {
    error(
      testMode
        ? `✗ REFUSED: --apply with ${TEST_MODE_ENV}=1 requires --db-url <127.0.0.1 url>.`
        : `✗ REFUSED: --apply requires DATABASE_URL in the environment.`,
    );
    return { ok: false, refused: true, mutated: false, reason: "no connection string" };
  }

  // ==== STATIC PRE-CONNECTION GATE (before ANY connection) =========
  // (a) PRODUCTION-MAIN: --migrations-folder must canonically resolve
  //     inside <repo>/db/.  TEST-DISPOSABLE fixtures may live in mkdtemp.
  if (!testMode) {
    const trust = assertTrustedProductionFolder({ folder: selected.folder, realpathFn });
    if (!trust.ok) {
      error(`✗ REFUSED (trusted-folder boundary — ZERO connections): ${trust.error}`);
      return { ok: false, refused: true, mutated: false, reason: trust.error, staticGate: false };
    }
  }
  // (b) FINDING A: --expected-fingerprint is mandatory for production and,
  //     whenever supplied, must MATCH the selected folder's fingerprint.
  if (!testMode && !expectedFingerprint) {
    const msg = "--expected-fingerprint <sha256> is required for a production apply (reviewer/operator supplied — never self-derived)";
    error(`✗ REFUSED (static pre-connection gate — ZERO connections): ${msg}`);
    return { ok: false, refused: true, mutated: false, reason: msg, staticGate: false };
  }
  if (expectedFingerprint && expectedFingerprint !== journal.fingerprint) {
    const msg = `--expected-fingerprint ${expectedFingerprint} does not match the selected folder fingerprint ${journal.fingerprint}`;
    error(`✗ REFUSED (static pre-connection gate — ZERO connections): ${msg}`);
    return { ok: false, refused: true, mutated: false, reason: msg, staticGate: false };
  }
  // (c) signature / --expected-db / --expected-pending / RBAC seed.
  const gate = staticPreConnectionGate({ connectionString, testMode, expectedDb, expectedPending, journal });
  if (!gate.ok) {
    error(`✗ REFUSED (static pre-connection gate — ZERO connections): ${gate.error}`);
    return { ok: false, refused: true, mutated: false, reason: gate.error, staticGate: false };
  }
  log(`  Static gate        : PASS (${gate.mode})`);

  // ---- connect --------------------------------------------------
  const connect = connectFn ?? (await defaultConnect());
  let conn;
  try {
    conn = await connect(connectionString);
  } catch (err) {
    error(`✗ REFUSED: could not connect to the target (details withheld): ${sanitizeError(err)}`);
    return { ok: false, refused: true, mutated: false, reason: "connect failed" };
  }

  try {
    // ---- FIRST READ-ONLY PREFLIGHT --------------------------
    const pre = await readOnlyPreflight(conn, { journal, expectedDb, connectionString, envMarker, testMode });
    log(`  Target host        : ${pre.redacted.host}:${pre.redacted.port}`);
    log(`  Target database    : ${pre.redacted.database}  (current_database(): ${pre.observed ?? "unknown"})`);
    log(`  Classification     : ${pre.classification}`);
    log(`  Reason             : ${pre.classificationReason}`);
    if (!pre.ok) {
      error(`✗ REFUSED: ${pre.error}. Nothing applied.`);
      return {
        ok: false, refused: true, mutated: false,
        classification: pre.classification, reason: pre.error,
        observedPending: pre.observedPending ?? null,
      };
    }

    const observedPending = pre.observedPending;
    const effectiveExpected =
      expectedPending ?? (pre.classification === "TEST-DISPOSABLE" ? observedPending : null);
    if (!effectiveExpected) {
      error(`✗ REFUSED: --expected-pending is required for a ${pre.classification} apply.`);
      return {
        ok: false, refused: true, mutated: false,
        classification: pre.classification, reason: "expected-pending required", observedPending,
      };
    }

    const eq = assertExpectedEqualsObserved(effectiveExpected, observedPending);
    if (!eq.ok) {
      error(`✗ REFUSED: ${eq.error}`);
      return {
        ok: false, refused: true, mutated: false,
        classification: pre.classification, reason: eq.error,
        observedPending, expectedPending: effectiveExpected,
      };
    }

    if (observedPending.length === 0) {
      log("  Nothing pending — the target is already at the selected journal head. No-op.");
      log("─".repeat(64));
      return {
        ok: true, mode: "noop", mutated: false,
        classification: pre.classification, observedPending, expectedPending: effectiveExpected,
      };
    }

    // ---- MUTATION PLAN ------------------------------------
    log("─".repeat(64));
    log("  MUTATION PLAN");
    log(`    classification     : ${pre.classification}`);
    log(`    target             : ${pre.redacted.host}:${pre.redacted.port}/${pre.redacted.database}`);
    log(`    migrations folder  : ${selected.folder}`);
    log(`    folder fingerprint : ${journal.fingerprint}`);
    log(`    last applied on tgt: ${pre.prefixLen > 0 ? journal.tags[pre.prefixLen - 1] : "(none)"}`);
    log(`    will apply (${observedPending.length})     : ${observedPending.join(", ")}`);
    log(`    expected (${effectiveExpected.length})        : ${effectiveExpected.join(", ")}`);
    if (pre.hashMismatchCount > 0) {
      log(`    ⚠ prefix hash drift : ${pre.hashMismatchCount} already-applied prefix row(s) have a recorded hash`);
      log(`                          that differs from this folder's .sql files (created_at prefix check PASSED):`);
      for (const m of pre.hashMismatches) {
        log(`                            ${m.tag}: recorded ${m.recorded}… vs local ${m.local}…`);
      }
      log(`                          Production requires ${PREFIX_HASH_DRIFT_FLAG} to proceed past this.`);
    }
    log("─".repeat(64));

    // ---- FINDING C: prefix-hash-drift acknowledgement gate (production)
    if (pre.hashMismatchCount > 0 && !testMode && !acknowledgePrefixHashDrift) {
      const msg = `prefix hash drift (${pre.hashMismatchCount} row(s)) is not acknowledged — re-run with ${PREFIX_HASH_DRIFT_FLAG} after reviewing the tags/hashes above`;
      error(`✗ REFUSED: ${msg}`);
      return {
        ok: false, refused: true, mutated: false,
        classification: pre.classification, reason: msg,
        observedPending, hashMismatchCount: pre.hashMismatchCount,
      };
    }

    // ---- CONFIRM ----------------------------------------
    const ask = promptFn ?? defaultPrompt;
    const answer = await ask(
      `Type "${CONFIRMATION_TOKEN}" to replay the ${observedPending.length} migration(s) above, anything else to cancel: `,
    );
    if (String(answer).trim() !== CONFIRMATION_TOKEN) {
      log("Cancelled — no migrations replayed.");
      return {
        ok: true, cancelled: true, mutated: false,
        classification: pre.classification, observedPending, expectedPending: effectiveExpected,
      };
    }

    // ---- SECOND READ-ONLY PREFLIGHT (DB change-window recheck) --
    const recheck = await readOnlyPreflight(conn, { journal, expectedDb, connectionString, envMarker, testMode });
    const dbStable =
      recheck.ok &&
      recheck.observed === pre.observed &&
      recheck.classification === pre.classification &&
      recheck.prefixLen === pre.prefixLen &&
      assertExpectedEqualsObserved(recheck.observedPending, observedPending).ok;
    if (!dbStable) {
      error("✗ REFUSED: target DB state changed between the read-only preflight and migrate(). Nothing applied.");
      return {
        ok: false, refused: true, mutated: false,
        classification: pre.classification, reason: "state changed in the change window", observedPending,
      };
    }

    // ---- FINDING B: ARTIFACT RE-CHECK, as close to migrate() as possible
    let journal2;
    try {
      journal2 = readJournalFn({ folder: selected.folder });
    } catch (err) {
      const msg = `the migration artifact could not be re-read before migrate(): ${sanitizeError(err)}`;
      error(`✗ REFUSED: ${msg}`);
      return { ok: false, refused: true, mutated: false, classification: pre.classification, reason: msg, observedPending };
    }
    const artifactStable =
      journal2.fingerprint === journal.fingerprint &&
      journal2.identity === journal.identity &&
      (expectedFingerprint ? journal2.fingerprint === expectedFingerprint : true);
    if (!artifactStable) {
      error("✗ REFUSED: the migration artifact (journal/SQL/fingerprint) changed between validation and migrate(). Nothing applied.");
      return {
        ok: false, refused: true, mutated: false,
        classification: pre.classification, reason: "migration artifact changed in the prompt window", observedPending,
      };
    }

    // ---- MIGRATE --------------------------------------
    const doMigrate = migrateFn ?? (await defaultMigrate());
    log("Replaying migrations (drizzle-orm migrate(), single transaction)…");
    try {
      await doMigrate(conn.drizzle, { migrationsFolder: selected.folder });
    } catch (err) {
      error(`✗ Migration FAILED and was rolled back atomically by drizzle: ${sanitizeError(err)}`);
      return {
        ok: false, mutated: false, migrationFailed: true,
        classification: pre.classification, reason: sanitizeError(err), observedPending,
      };
    }

    // ---- POST-VERIFY --------------------------------
    let post;
    try {
      post = await postVerify(conn, { journal, prefixLen: pre.prefixLen, appliedPending: observedPending });
    } catch (err) {
      error(`✗ Post-migration verification threw AFTER migrate() committed: ${sanitizeError(err)}`);
      return {
        ok: false, mutated: true, verifyFailed: true,
        classification: pre.classification, reason: sanitizeError(err), observedPending,
      };
    }
    log(`  Post-verify        : recorded ${post.recordedCount} row(s) (expected ${post.expectedCount}), latest "${post.latestTag}"`);
    for (const s of post.structural) {
      log(`  Structural [${s.tag}] : ${s.ok ? "✓" : "✗"} ${s.detail}`);
    }
    log("─".repeat(64));
    if (!post.ok) {
      error("✗ Post-migration verification FAILED — inspect the target manually. (migrate() itself committed or rolled back atomically.)");
      return { ok: false, mutated: true, verifyFailed: true, classification: pre.classification, observedPending, post };
    }
    return {
      ok: true, mutated: true,
      classification: pre.classification,
      appliedPending: observedPending, expectedPending: effectiveExpected,
      roleRows: post.rbac?.roleRows, post,
    };
  } catch (err) {
    // Any unexpected throw from the preflight / gate / prompt / recheck
    // path: nothing was applied (migrate() is guarded by its own try above).
    const msg = sanitizeError(err);
    error(`✗ REFUSED (unexpected error before mutation, nothing applied): ${msg}`);
    return { ok: false, refused: true, mutated: false, reason: msg, phase: "preflight" };
  } finally {
    await conn.end?.().catch(() => {});
  }
}

function sanitizeError(err) {
  // Never echo a connection string / credentials a pg error may embed.
  return String(err?.code ?? err?.message ?? err)
    .replace(/postgres(ql)?:\/\/\S+/gi, "<redacted>")
    .replace(/\/\/[^\s/@]+:[^\s/@]+@\S+/g, "//<redacted>")
    .replace(/password=\S+/gi, "password=<redacted>");
}

async function defaultPrompt(q) {
  const rl = createInterface({ input: process.stdin, output: process.stdout });
  const a = await rl.question(q);
  rl.close();
  return a;
}

async function defaultConnect() {
  // A single dedicated Client (not a Pool): the read-only preflights, the
  // artifact re-check, and migrate() must all run on the SAME backend
  // connection so `BEGIN READ ONLY … ROLLBACK` means what it says.
  const { Client } = await import("pg");
  const { drizzle } = await import("drizzle-orm/node-postgres");
  return async (connectionString) => {
    const client = new Client({ connectionString });
    await client.connect();
    return {
      query: (sql, params) => client.query(sql, params),
      drizzle: drizzle(client),
      end: () => client.end(),
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
