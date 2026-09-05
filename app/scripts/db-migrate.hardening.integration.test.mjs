// PHASE CRM-MIGRATOR-HARDENING-1 — disposable-container integration tests
// for the hardened scripts/db-migrate.mjs (--migrations-folder +
// --expected-pending + clean-prefix + exact-authorization gate +
// change-window recheck).
//
// Spins its OWN ephemeral postgres:16-alpine (random name + port, --rm,
// destroyed in `after`). NEVER touches public-map-approval-test-db /
// public-map-audit-test-db, NEVER Preview/Production, NEVER a remote host.
// The hardened run() is driven with NO injected connectFn — it uses the
// real defaultConnect() (a single pg Client) against 127.0.0.1 in
// RBAC_MIG_TEST_MODE=1.
//
// The 0033-boundary fixture is BUILT AT RUNTIME from the committed
// db/migrations files (journal filtered to idx 0..33) — no generated
// fixture is checked into a runtime path, and historical migrations are
// never mutated.
//
// Requires Docker. Run:
//   npx tsx --test scripts/db-migrate.hardening.integration.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID, createHash } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { mkdtempSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { Pool } from "pg";

import { drizzle } from "drizzle-orm/node-postgres";
import { migrate } from "drizzle-orm/node-postgres/migrator";
import { run as runMigrate, readMigrationJournal } from "./db-migrate.mjs";

const CONTAINER = `pm-db-migrate-hardening-${randomUUID().slice(0, 8)}`;
const HOST_PORT = 5640 + Math.floor(Math.random() * 60); // 5640-5699 — clear of 5432/5433/5434 and the other suites
const PG_USER = "db_migrate_hardening";
const PG_PASSWORD = "db_migrate_hardening_local_only";
const PG_DB = "db_migrate_hardening_check";
const URL = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${HOST_PORT}/${PG_DB}`;

if (/supabase|neon|pooler/i.test(URL) || !/@127\.0\.0\.1:/.test(URL)) {
  throw new Error("REFUS : cible non locale. Arret avant tout demarrage de conteneur.");
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const TEST_ENV = { RBAC_MIG_TEST_MODE: "1" };
const silent = { log: () => {}, error: () => {} };

const REAL_MIGRATIONS = "db/migrations";
const REAL_JOURNAL = JSON.parse(readFileSync(`${REAL_MIGRATIONS}/meta/_journal.json`, "utf8"));
const TAG_0031 = "0031_stiff_leech";
const TAG_0032 = "0032_cool_red_wolf";
const TAG_0033 = "0033_reflective_wolf_cub";
const REPAIR_SET = [TAG_0031, TAG_0032, TAG_0033];

let pool;
let containerStarted = false;
let folder33; // journal 0000..0033
let folder30; // journal 0000..0030
let folder34x; // folder33 + one synthetic later migration

// Build a migrations folder containing exactly journal entries with idx <= maxIdx.
function buildFolder(label, maxIdx, extraEntry) {
  const dir = mkdtempSync(join(tmpdir(), `pm-mig-${label}-`));
  mkdirSync(join(dir, "meta"), { recursive: true });
  const entries = REAL_JOURNAL.entries.filter((e) => e.idx <= maxIdx).map((e) => ({ ...e }));
  for (const e of entries) {
    writeFileSync(join(dir, `${e.tag}.sql`), readFileSync(`${REAL_MIGRATIONS}/${e.tag}.sql`));
  }
  if (extraEntry) {
    entries.push(extraEntry.journal);
    writeFileSync(join(dir, `${extraEntry.journal.tag}.sql`), extraEntry.sql);
  }
  writeFileSync(join(dir, "meta", "_journal.json"), JSON.stringify({ ...REAL_JOURNAL, entries }, null, 2));
  return dir;
}

async function resetDb() {
  await pool.query("DROP SCHEMA IF EXISTS drizzle CASCADE");
  await pool.query("DROP SCHEMA IF EXISTS public CASCADE");
  await pool.query("CREATE SCHEMA public");
}
async function seedPrefix(folder) {
  await migrate(drizzle(pool), { migrationsFolder: folder });
}
const q1 = async (sql) => (await pool.query(sql)).rows[0];
const tableExists = async (name) =>
  (await q1(`select to_regclass('public.${name}') is not null as x`)).x;
const columnExists = async (table, col) =>
  (await q1(
    `select count(*)::int n from information_schema.columns where table_schema='public' and table_name='${table}' and column_name='${col}'`,
  )).n === 1;
const migrationCount = async () =>
  (await q1("select count(*)::int n from drizzle.__drizzle_migrations")).n;
const latestMigrationWhen = async () =>
  Number((await q1("select max(created_at)::bigint w from drizzle.__drizzle_migrations")).w);

before(async () => {
  if (sh("docker", ["info"], { stdio: "ignore" }).status !== 0) {
    throw new Error("Docker indisponible — demarre Docker et relance. Rien n'a ete cree.");
  }
  const runc = sh("docker", [
    "run", "-d", "--rm",
    "--name", CONTAINER,
    "-e", `POSTGRES_USER=${PG_USER}`,
    "-e", `POSTGRES_PASSWORD=${PG_PASSWORD}`,
    "-e", `POSTGRES_DB=${PG_DB}`,
    "-p", `127.0.0.1:${HOST_PORT}:5432`,
    "postgres:16-alpine",
  ]);
  if (runc.status !== 0) throw new Error(`docker run a echoue : ${runc.stderr}`);
  containerStarted = true;

  pool = new Pool({ connectionString: URL });
  let ready = false;
  for (let i = 0; i < 60 && !ready; i++) {
    try { await pool.query("select 1"); ready = true; } catch { await sleep(500); }
  }
  if (!ready) throw new Error("Postgres jetable jamais pret.");
  assert.equal((await q1("select current_database() as db")).db, PG_DB);

  folder33 = buildFolder("33", 33);
  folder30 = buildFolder("30", 30);
  const w0033 = REAL_JOURNAL.entries.find((e) => e.tag === TAG_0033).when;
  folder34x = buildFolder("34x", 33, {
    journal: { idx: 34, version: REAL_JOURNAL.entries[0].version, when: w0033 + 100000, tag: "0034_zz_synthetic_test", breakpoints: true },
    sql: 'CREATE TABLE "zz_synthetic_test" ("id" integer);',
  });

  // sanity: the built journal ends exactly at 0033
  const j33 = JSON.parse(readFileSync(join(folder33, "meta", "_journal.json"), "utf8"));
  assert.equal(j33.entries[j33.entries.length - 1].tag, TAG_0033);
});

after(async () => {
  await pool?.end().catch(() => {});
  if (containerStarted) sh("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

// ────────────────────────────────────────────────────────────────────
test("J. fresh disposable DB + pinned 0033 folder + no --expected-pending → convenience full replay to 0033", async () => {
  await resetDb();
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mutated, true);
  assert.equal(r.classification, "TEST-DISPOSABLE");
  assert.equal(await migrationCount(), 34);
  assert.equal(await tableExists("staff_roles"), false);
  assert.equal(await tableExists("staff_members"), false);
  assert.equal(await tableExists("staff_invitations"), false);
});

test("K. DB at 0000..0030 + pinned 0033 folder → observed pending is EXACTLY [0031,0032,0033]", async () => {
  await resetDb();
  await seedPrefix(folder30);
  assert.equal(await migrationCount(), 31);
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", REPAIR_SET.join(",")],
    env: TEST_ENV,
    promptFn: async () => "do not apply",
    ...silent,
  });
  assert.equal(r.cancelled, true, JSON.stringify(r));
  assert.deepEqual(r.observedPending, REPAIR_SET);
  assert.equal(await tableExists("crm_quote_access_links"), false); // nothing applied
});

test("L + V + section-18 repair proof: DB 0000..0030 + folder33 + expected [0031,0032,0033] → applies exactly those, 0034 never runs", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", REPAIR_SET.join(",")],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mutated, true);
  assert.deepEqual(r.appliedPending, REPAIR_SET);

  // 0031 effects
  assert.equal(await tableExists("crm_quote_access_links"), true);
  // 0032 effects
  assert.equal(await columnExists("crm_clients", "industry"), true);
  assert.equal(await columnExists("crm_clients", "do_not_contact"), true);
  assert.equal(await columnExists("crm_clients", "do_not_contact_reason"), true);
  // 0033 effects
  assert.equal(await columnExists("interactions", "direction"), true);
  assert.equal(await columnExists("interactions", "outcome"), true);
  // metadata: clean prefix 0000..0033
  assert.equal(await migrationCount(), 34);
  assert.equal(await latestMigrationWhen(), REAL_JOURNAL.entries.find((e) => e.tag === TAG_0033).when);
  // 0034 / RBAC absent
  assert.equal(await tableExists("staff_roles"), false);
  assert.equal(await tableExists("staff_members"), false);
  assert.equal(await tableExists("staff_invitations"), false);

  // T. exact rerun → observed pending now empty, expected non-empty → refused, no re-run
  const rr = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", REPAIR_SET.join(",")],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(rr.refused, true, JSON.stringify(rr));
  assert.equal(await migrationCount(), 34);
});

test("M. folder33 + expected [0031,0032] (not the journal's trailing slice) → refused locally, zero mutation", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", `${TAG_0031},${TAG_0032}`],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(await tableExists("crm_quote_access_links"), false);
});

test("N. folder33 + expected includes 0034 (absent from that journal) → refused locally", async () => {
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", `${TAG_0031},${TAG_0032},${TAG_0033},0034_aberrant_earthquake`],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
});

test("O.1 HEAD journal (ends 0034) + expected [0031,0032,0033] → refused locally (0031..0033 is not its trailing slice)", async () => {
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", REAL_MIGRATIONS, "--expected-pending", REPAIR_SET.join(",")],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
});

test("O.2 HEAD journal + DB at 0030 + expected = valid trailing slice [0033,0034,0035] → equality gate refuses (observed pending also has 0031,0032)", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", REAL_MIGRATIONS, "--expected-pending", `${TAG_0033},0034_aberrant_earthquake,0035_tough_phil_sheldon`],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.match(r.reason, /does not equal the target's actual pending set/);
  assert.equal(await tableExists("crm_quote_access_links"), false); // 0031 not applied
  assert.equal(await tableExists("staff_roles"), false); // 0034 not applied
});

test("P. metadata non-prefix (interior row deleted) → refused, zero mutation", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const interiorWhen = REAL_JOURNAL.entries.find((e) => e.idx === 15).when;
  await pool.query("delete from drizzle.__drizzle_migrations where created_at = $1", [interiorWhen]);
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", REPAIR_SET.join(",")],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.match(r.reason, /clean contiguous prefix/);
  assert.equal(await tableExists("crm_quote_access_links"), false);
});

test("Q. metadata with an unknown created_at row → refused, zero mutation", async () => {
  await resetDb();
  await seedPrefix(folder30);
  await pool.query("insert into drizzle.__drizzle_migrations (hash, created_at) values ('bogus', 999999999999999)");
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", REPAIR_SET.join(",")],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(await tableExists("crm_quote_access_links"), false);
});

test("R. --expected-db mismatch → refused before mutation", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", REPAIR_SET.join(","), "--expected-db", "not_the_real_db"],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(await tableExists("crm_quote_access_links"), false);
});

test("S. confirmation token withheld → zero mutation", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33, "--expected-pending", REPAIR_SET.join(",")],
    env: TEST_ENV,
    promptFn: async () => "",
    ...silent,
  });
  assert.equal(r.cancelled, true, JSON.stringify(r));
  assert.equal(r.mutated, false);
  assert.equal(await tableExists("crm_quote_access_links"), false);
});

test("U. a future extra migration in the folder + expected = older set → refused locally", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder34x, "--expected-pending", REPAIR_SET.join(",")],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.equal(await tableExists("zz_synthetic_test"), false);
  assert.equal(await tableExists("crm_quote_access_links"), false);
});

test("fingerprint: the pinned folder33 fingerprint is deterministic across rebuilds", () => {
  const rebuilt = buildFolder("33b", 33);
  const fp = (dir) => {
    const j = JSON.parse(readFileSync(join(dir, "meta", "_journal.json"), "utf8"));
    const h = j.entries.map((e) => createHash("sha256").update(readFileSync(join(dir, `${e.tag}.sql`))).digest("hex"));
    return createHash("sha256").update(h.join("\n")).digest("hex");
  };
  assert.equal(fp(folder33), fp(rebuilt));
});

// ════════════════════════ CRM-MIGRATOR-HARDENING-2 ════════════════════════
// --expected-fingerprint + artifact TOCTOU recheck + CRM structural postVerify.

const fp33 = () => readMigrationJournal({ folder: folder33 }).fingerprint;

test("H2-A. 0030 → folder33 + expected-pending + correct --expected-fingerprint → applies exactly 0031–0033; structural verifiers pass", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: [
      "--apply", "--db-url", URL, "--migrations-folder", folder33,
      "--expected-pending", REPAIR_SET.join(","), "--expected-fingerprint", fp33(),
    ],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.appliedPending, REPAIR_SET);
  assert.deepEqual(r.post.structural.map((s) => `${s.tag}:${s.ok}`), REPAIR_SET.map((t) => `${t}:true`));
  assert.equal(await tableExists("crm_quote_access_links"), true);
  assert.equal(await columnExists("crm_clients", "industry"), true);
  assert.equal(await columnExists("interactions", "outcome"), true);
  assert.equal(await migrationCount(), 34);
  assert.equal(await tableExists("staff_roles"), false); // F/G: 0034 + staff_* absent
  assert.equal(await tableExists("staff_members"), false);
});

test("H2-B. 0030 → folder33 + WRONG --expected-fingerprint → refused before connection, zero mutation", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: [
      "--apply", "--db-url", URL, "--migrations-folder", folder33,
      "--expected-pending", REPAIR_SET.join(","), "--expected-fingerprint", "a".repeat(64),
    ],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.match(r.reason, /does not match the selected folder fingerprint/);
  assert.equal(await tableExists("crm_quote_access_links"), false);
  assert.equal(await migrationCount(), 31);
});

test("H2-C. artifact SQL rewritten during the prompt window → refused, zero migration mutation", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const folder33c = buildFolder("33c", 33);
  const r = await runMigrate({
    argv: [
      "--apply", "--db-url", URL, "--migrations-folder", folder33c,
      "--expected-pending", REPAIR_SET.join(","), "--expected-fingerprint", readMigrationJournal({ folder: folder33c }).fingerprint,
    ],
    env: TEST_ENV,
    promptFn: async () => {
      // tamper a selected .sql AFTER validation, BEFORE migrate()
      writeFileSync(join(folder33c, `${TAG_0033}.sql`), 'ALTER TABLE "interactions" ADD COLUMN "direction" text;\n-- tampered\n');
      return "MIGRATE";
    },
    ...silent,
  });
  assert.equal(r.refused, true, JSON.stringify(r));
  assert.match(r.reason, /artifact changed/);
  assert.equal(await tableExists("crm_quote_access_links"), false);
  assert.equal(await migrationCount(), 31);
});

test("H2-E. CRM structure broken between migrate() and postVerify → verifyFailed=true, mutated=true, not success", async () => {
  await resetDb();
  await seedPrefix(folder30);
  const r = await runMigrate({
    argv: [
      "--apply", "--db-url", URL, "--migrations-folder", folder33,
      "--expected-pending", REPAIR_SET.join(","), "--expected-fingerprint", fp33(),
    ],
    env: TEST_ENV,
    migrateFn: async (dz, opts) => {
      await migrate(dz, opts);
      await pool.query('ALTER TABLE "crm_clients" DROP COLUMN "industry"');
    },
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.ok, false, JSON.stringify(r));
  assert.equal(r.verifyFailed, true);
  assert.equal(r.mutated, true);
  const s0032 = r.post.structural.find((s) => s.tag === TAG_0032);
  assert.equal(s0032.ok, false);
});

test("H2-H. existing full-disposable convenience path still works with the hardened tool", async () => {
  await resetDb();
  const r = await runMigrate({
    argv: ["--apply", "--db-url", URL, "--migrations-folder", folder33],
    env: TEST_ENV,
    promptFn: async () => "MIGRATE",
    ...silent,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mutated, true);
  assert.equal(await migrationCount(), 34);
  assert.equal(await tableExists("staff_roles"), false);
});
