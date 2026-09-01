// PHASE RBAC-MIG-TOOLING — unit tests for scripts/db-migrate.mjs's run().
// Zero network, zero real DB, zero real subprocess: connectFn / migrateFn /
// readJournalFn / promptFn / log / error are all injected fakes.
// Run: npx tsx --test scripts/db-migrate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

import { run, readMigrationJournal, CONFIRMATION_TOKEN } from "./db-migrate.mjs";

const GOOD_JOURNAL = { tags: ["0000_x", "0034_aberrant_earthquake"], has0034: true, seedPresent: true };
const journalFn = (j = GOOD_JOURNAL) => () => j;

// A fake connection: `query` answers by SQL pattern; records everything.
function fakeConn({ currentDb = "rbac_replay_check", roles = ["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"], tables = 3, staffMembers = 0 } = {}) {
  const calls = [];
  return {
    calls,
    conn: {
      query: async (sql) => {
        calls.push(sql);
        if (/current_database/i.test(sql)) return { rows: [{ db: currentDb }] };
        if (/from staff_roles/i.test(sql)) return { rows: roles.map((name) => ({ name })) };
        if (/information_schema\.tables/i.test(sql)) return { rows: [{ n: tables }] };
        if (/count\(\*\)::int n from staff_members/i.test(sql)) return { rows: [{ n: staffMembers }] };
        return { rows: [] };
      },
      drizzle: { __fake: true },
      end: async () => {},
    },
  };
}
const connectFnFrom = (f) => async () => f.conn;
const collect = () => {
  const lines = [];
  return { sink: (l) => lines.push(String(l)), lines, text: () => lines.join("\n") };
}

// ---- journal reader -------------------------------------------------
test("readMigrationJournal finds 0034 and its idempotent staff_roles seed in the real repo files", () => {
  const j = readMigrationJournal();
  assert.equal(j.has0034, true, "0034 must be in db/migrations/meta/_journal.json");
  assert.equal(j.seedPresent, true, "0034_aberrant_earthquake.sql must contain the ON CONFLICT DO NOTHING staff_roles seed");
});

test("readMigrationJournal reports seedPresent=false if the seed text is gone (injected fake reader)", () => {
  const fakeRead = (p) => {
    if (p.endsWith("_journal.json")) return JSON.stringify({ entries: [{ tag: "0034_aberrant_earthquake" }] });
    return `CREATE TABLE "staff_roles" ("id" uuid);`; // no INSERT ... ON CONFLICT
  };
  const j = readMigrationJournal({ readFileFn: fakeRead });
  assert.equal(j.has0034, true);
  assert.equal(j.seedPresent, false);
});

// ---- default = inspection, no connection, no mutation --------------
test("default mode opens NO connection and calls migrate() never", async () => {
  const out = collect();
  let connectCalled = false;
  const r = await run({
    argv: [],
    env: {},
    readJournalFn: journalFn(),
    connectFn: async () => {
      connectCalled = true;
      throw new Error("must not connect in inspection mode");
    },
    migrateFn: async () => assert.fail("migrate() must not run in inspection mode"),
    log: out.sink,
    error: out.sink,
  });
  assert.equal(connectCalled, false);
  assert.equal(r.ok, true);
  assert.equal(r.mode, "inspection");
  assert.equal(r.mutated, false);
  assert.match(out.text(), /INSPECTION \(default\)/);
  assert.match(out.text(), /NOT drizzle-kit push/);
});

test("refuses if 0034 is missing from the journal", async () => {
  const r = await run({ argv: [], env: {}, readJournalFn: journalFn({ tags: [], has0034: false, seedPresent: false }), log: () => {}, error: () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
});

test("refuses if the 0034 seed text is absent (a replay would not seed roles)", async () => {
  const r = await run({ argv: [], env: {}, readJournalFn: journalFn({ tags: ["0034_aberrant_earthquake"], has0034: true, seedPresent: false }), log: () => {}, error: () => {} });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
});

// ---- --apply guards ----------------------------------------------
test("--apply without DATABASE_URL is refused before any connection", async () => {
  let connected = false;
  const r = await run({
    argv: ["--apply", "--expected-db", "prod"],
    env: {},
    readJournalFn: journalFn(),
    connectFn: async () => { connected = true; return {}; },
    log: () => {}, error: () => {},
  });
  assert.equal(connected, false);
  assert.equal(r.refused, true);
});

test("--apply against a real target without --expected-db is refused", async () => {
  const r = await run({
    argv: ["--apply"],
    env: { DATABASE_URL: "postgresql://u:p@db.zmndhiujxfxncebezxhb.supabase.co:5432/postgres" },
    readJournalFn: journalFn(),
    connectFn: async () => assert.fail("must not connect without --expected-db"),
    log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.match(r.reason, /expected-db/);
});

test("--apply refuses when the production signature is absent (non-prod URL, prod marker set)", async () => {
  const f = fakeConn({ currentDb: "something" });
  const r = await run({
    argv: ["--apply", "--expected-db", "something"],
    env: { DATABASE_URL: "postgresql://u:p@some-random-host:5432/something", RBAC_BOOTSTRAP_TARGET: "production-main" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(f),
    migrateFn: async () => assert.fail("migrate() must not run for a REFUSED target"),
    log: () => {}, error: () => {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.refused, true);
  assert.match(r.reason, /signature/);
});

test("--apply refuses when current_database() != --expected-db", async () => {
  const f = fakeConn({ currentDb: "wrong_name" });
  const r = await run({
    argv: ["--apply", "--expected-db", "public_map_prod"],
    env: { DATABASE_URL: "postgresql://u:p@db.zmndhiujxfxncebezxhb.supabase.co:5432/postgres", RBAC_BOOTSTRAP_TARGET: "production-main" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(f),
    migrateFn: async () => assert.fail("migrate() must not run"),
    log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
});

test("--apply refuses when the RBAC_BOOTSTRAP_TARGET env marker is missing", async () => {
  const f = fakeConn({ currentDb: "public_map_prod" });
  const r = await run({
    argv: ["--apply", "--expected-db", "public_map_prod"],
    env: { DATABASE_URL: "postgresql://u:p@db.zmndhiujxfxncebezxhb.supabase.co:5432/postgres" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(f),
    migrateFn: async () => assert.fail("migrate() must not run"),
    log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
});

test("wrong confirmation token cancels without calling migrate()", async () => {
  const f = fakeConn({ currentDb: "public_map_prod" });
  let migrated = false;
  const r = await run({
    argv: ["--apply", "--expected-db", "public_map_prod"],
    env: { DATABASE_URL: "postgresql://u:p@db.zmndhiujxfxncebezxhb.supabase.co:5432/postgres", RBAC_BOOTSTRAP_TARGET: "production-main" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(f),
    migrateFn: async () => { migrated = true; },
    promptFn: async () => "yes go",
    log: () => {}, error: () => {},
  });
  assert.equal(migrated, false);
  assert.equal(r.cancelled, true);
  assert.equal(r.mutated, false);
});

test("all three prod signals + exact token → migrate() runs once, then post-verify passes", async () => {
  const f = fakeConn({ currentDb: "public_map_prod", roles: ["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"], tables: 3 });
  let migrateArgs = null;
  const r = await run({
    argv: ["--apply", "--expected-db", "public_map_prod"],
    env: { DATABASE_URL: "postgresql://u:p@db.zmndhiujxfxncebezxhb.supabase.co:5432/postgres", RBAC_BOOTSTRAP_TARGET: "production-main" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(f),
    migrateFn: async (dz, opts) => { migrateArgs = { dz, opts }; },
    promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {}, error: () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.mutated, true);
  assert.equal(r.classification, "PRODUCTION-MAIN");
  assert.ok(migrateArgs, "migrate() must have been called");
  assert.equal(migrateArgs.opts.migrationsFolder, "db/migrations");
  assert.deepEqual(r.roleRows, ["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"]);
});

test("post-verify FAILS the run if the seed did not land exactly", async () => {
  const f = fakeConn({ currentDb: "public_map_prod", roles: ["ADMIN", "OWNER"], tables: 3 });
  const r = await run({
    argv: ["--apply", "--expected-db", "public_map_prod"],
    env: { DATABASE_URL: "postgresql://u:p@db.zmndhiujxfxncebezxhb.supabase.co:5432/postgres", RBAC_BOOTSTRAP_TARGET: "production-main" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(f),
    migrateFn: async () => {},
    promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {}, error: () => {},
  });
  assert.equal(r.ok, false);
  assert.equal(r.verifyFailed, true);
});

// ---- disposable-test path ---------------------------------------
test("RBAC_MIG_TEST_MODE=1 + 127.0.0.1 --db-url applies without prod signals", async () => {
  const f = fakeConn({ currentDb: "rbac_replay_check" });
  let migrated = false;
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://replay:x@127.0.0.1:5511/rbac_replay_check"],
    env: { RBAC_MIG_TEST_MODE: "1" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(f),
    migrateFn: async () => { migrated = true; },
    promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {}, error: () => {},
  });
  assert.equal(migrated, true);
  assert.equal(r.classification, "TEST-DISPOSABLE");
});

test("RBAC_MIG_TEST_MODE=1 refuses a non-127.0.0.1 --db-url", async () => {
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://u:p@remote.example.com:5432/x"],
    env: { RBAC_MIG_TEST_MODE: "1" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(fakeConn({ currentDb: "x" })),
    migrateFn: async () => assert.fail("must not migrate a remote host in test mode"),
    log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
});

test("RBAC_MIG_TEST_MODE=1 refuses a 127.0.0.1 URL that carries the production signature", async () => {
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://zmndhiujxfxncebezxhb:x@127.0.0.1:5511/x"],
    env: { RBAC_MIG_TEST_MODE: "1" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(fakeConn({ currentDb: "x" })),
    migrateFn: async () => assert.fail("must not migrate"),
    log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
});

// ---- redaction -----------------------------------------------
test("no output line ever contains the raw connection string or credentials", async () => {
  const out = collect();
  const f = fakeConn({ currentDb: "public_map_prod" });
  await run({
    argv: ["--apply", "--expected-db", "public_map_prod"],
    env: { DATABASE_URL: "postgresql://secretuser:secretpw@db.zmndhiujxfxncebezxhb.supabase.co:5432/public_map_prod", RBAC_BOOTSTRAP_TARGET: "production-main" },
    readJournalFn: journalFn(),
    connectFn: connectFnFrom(f),
    migrateFn: async () => {},
    promptFn: async () => CONFIRMATION_TOKEN,
    log: out.sink,
    error: out.sink,
  });
  assert.doesNotMatch(out.text(), /secretuser|secretpw/);
  assert.doesNotMatch(out.text(), /postgres(ql)?:\/\//i);
});
