// PHASE RBAC-MIG-TOOLING + CRM-MIGRATOR-HARDENING-1 + -2 — unit tests for
// scripts/db-migrate.mjs. Zero network, zero real DB, zero real subprocess:
// connectFn / migrateFn / readJournalFn / promptFn / realpathFn / log /
// error are all injected fakes. The real-FS tests only READ committed repo
// files or operate inside an mkdtemp sandbox.
// Run: npx tsx --test scripts/db-migrate.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { mkdtempSync, mkdirSync, symlinkSync, realpathSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import {
  run,
  readMigrationJournal,
  parseExpectedPending,
  parseExpectedFingerprint,
  validateExpectedPendingLocally,
  computeCleanPrefixAndPending,
  assertExpectedEqualsObserved,
  assertTrustedProductionFolder,
  resolveMigrationsFolder,
  staticPreConnectionGate,
  STRUCTURAL_VERIFIERS,
  CONFIRMATION_TOKEN,
  DEFAULT_MIGRATIONS_FOLDER,
  RBAC_SEED_MIGRATION_TAG,
  PREFIX_HASH_DRIFT_FLAG,
} from "./db-migrate.mjs";

const PROD_URL = "postgresql://u:p@db.zmndhiujxfxncebezxhb.supabase.co:5432/postgres";
const PROD_ENV = (over = {}) => ({ DATABASE_URL: PROD_URL, RBAC_BOOTSTRAP_TARGET: "production-main", ...over });
const FP = "f".repeat(64); // default fake-journal fingerprint

// realpathFn fakes for assertTrustedProductionFolder (folder trust, prod only)
const RP_OK = (p) => (/(^|\/)db$/.test(p) ? "/T/db" : "/T/db/artifact");
const RP_ESCAPE = (p) => (/(^|\/)db$/.test(p) ? "/T/db" : "/evil/outside");

// A hand-built journal shaped like readMigrationJournal()'s return.
function fakeJournal(tags, { rbacSeedOk = null, fingerprint = FP, identity } = {}) {
  const entries = tags.map((tag, i) => ({
    idx: i, tag, when: (i + 1) * 100, sql: `-- ${tag}`, hash: `h_${tag}`, sqlPath: `fake/${tag}.sql`,
  }));
  return {
    folder: "fake",
    entries,
    tags: [...tags],
    fingerprint,
    identity: identity ?? entries.map((e) => `${e.idx}:${e.tag}:${e.when}`).join("|"),
    rbacSeedMigrationPresent: tags.includes(RBAC_SEED_MIGRATION_TAG),
    rbacSeedOk: tags.includes(RBAC_SEED_MIGRATION_TAG) ? (rbacSeedOk ?? true) : null,
  };
}
const journalFn = (j) => () => j;
const statefulJournalFn = (journals) => { let i = 0; return () => journals[Math.min(i++, journals.length - 1)]; };

// Flexible fake connection.
function makeFakeConn({
  currentDb = "proddb",
  reg = "drizzle.__drizzle_migrations",
  datasets = [[]],
  roleRows = ["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"],
  tablesN = 3,
  structural = {},
} = {}) {
  const s0031 = { tbl: true, link_cols: 8, link_idx: 2, link_fk: 1, ...structural };
  const s0032 = { client_cols: 3, dnc_notnull: 1, client_idx: 1, ...structural };
  const s0033 = { interaction_cols: 2, ...structural };
  const calls = [];
  const state = { begins: 0, recorded: null, migrateCalled: 0, _active: [] };
  const conn = {
    query: async (sql) => {
      calls.push(sql);
      if (/^BEGIN READ ONLY/i.test(sql)) {
        const ds = datasets[Math.min(state.begins, datasets.length - 1)];
        state.begins += 1;
        if (state.recorded === null) state.recorded = ds.map((r) => ({ ...r }));
        state._active = ds.map((r) => ({ ...r }));
        return { rows: [] };
      }
      if (/^ROLLBACK/i.test(sql)) return { rows: [] };
      if (/current_database\(\)/i.test(sql)) return { rows: [{ db: currentDb }] };
      if (/to_regclass\('drizzle/i.test(sql)) return { rows: [{ reg }] };
      if (/id,\s*hash,\s*created_at\s+from\s+drizzle/i.test(sql)) return { rows: state._active ?? [] };
      if (/select\s+created_at\s+from\s+drizzle/i.test(sql)) {
        return { rows: (state.recorded ?? []).slice().sort((a, b) => a.created_at - b.created_at) };
      }
      if (/as link_cols/i.test(sql)) return { rows: [s0031] };
      if (/as client_cols/i.test(sql)) return { rows: [s0032] };
      if (/as interaction_cols/i.test(sql)) return { rows: [s0033] };
      if (/from staff_roles/i.test(sql)) return { rows: roleRows.map((name) => ({ name })) };
      if (/information_schema\.tables/i.test(sql)) return { rows: [{ n: tablesN }] };
      return { rows: [] };
    },
    drizzle: { __fake: true },
    end: async () => {},
  };
  return { conn, calls, state };
}
const fakeMigrate = (fake, _journal, pendingWhens) => async () => {
  fake.state.migrateCalled += 1;
  for (const w of pendingWhens) fake.state.recorded.push({ hash: "h", created_at: w });
};
const collect = () => {
  const lines = [];
  return { sink: (l) => lines.push(String(l)), text: () => lines.join("\n") };
};

// Shorthand: a production `run()` with the folder-trust realpath + a
// matching --expected-fingerprint already wired. Callers override argv/env/conn.
function prodRun({ argv = [], env, journal, ...rest }) {
  return run({
    argv: ["--apply", "--expected-fingerprint", FP, ...argv],
    env: env ?? PROD_ENV(),
    readJournalFn: journalFn(journal),
    realpathFn: RP_OK,
    log: () => {}, error: () => {},
    ...rest,
  });
}

// ───────────────────────── pure: parseExpectedFingerprint ────────────────────
test("parseExpectedFingerprint: 64-hex accepted, case-normalised; else rejected", () => {
  assert.equal(parseExpectedFingerprint(undefined).ok, false);
  assert.equal(parseExpectedFingerprint("").ok, false);
  assert.equal(parseExpectedFingerprint("z".repeat(64)).ok, false);
  assert.equal(parseExpectedFingerprint("a".repeat(63)).ok, false);
  assert.equal(parseExpectedFingerprint("a".repeat(65)).ok, false);
  const r = parseExpectedFingerprint("A".repeat(64));
  assert.equal(r.ok, true);
  assert.equal(r.value, "a".repeat(64));
});

// ───────────────────────── pure: assertTrustedProductionFolder ───────────────
test("assertTrustedProductionFolder: folder inside <repo>/db accepted (injected realpath)", () => {
  assert.equal(assertTrustedProductionFolder({ folder: "db/migrations", realpathFn: RP_OK }).ok, true);
});
test("assertTrustedProductionFolder: folder resolving outside <repo>/db refused", () => {
  const r = assertTrustedProductionFolder({ folder: "db/whatever", realpathFn: RP_ESCAPE });
  assert.equal(r.ok, false);
  assert.match(r.error, /OUTSIDE the trusted production migration boundary/);
});
test("assertTrustedProductionFolder: unresolvable folder refused", () => {
  const rp = (p) => { if (/(^|\/)db$/.test(p)) return "/T/db"; throw new Error("ENOENT"); };
  assert.equal(assertTrustedProductionFolder({ folder: "nope", realpathFn: rp }).ok, false);
});
test("assertTrustedProductionFolder: real symlink escape under db/ refused; real subdir allowed", () => {
  const root = mkdtempSync(join(tmpdir(), "pm-trust-"));
  mkdirSync(join(root, "db"));
  mkdirSync(join(root, "db", "good"));
  symlinkSync(realpathSync(tmpdir()), join(root, "db", "badlink"), "dir");
  assert.equal(assertTrustedProductionFolder({ folder: join(root, "db", "good"), repoRoot: root, realpathFn: realpathSync }).ok, true);
  const bad = assertTrustedProductionFolder({ folder: join(root, "db", "badlink"), repoRoot: root, realpathFn: realpathSync });
  assert.equal(bad.ok, false);
});

// ───────────────────────── pure: parseExpectedPending ────────────────────────
test("parseExpectedPending: ok / trim / order; rejects missing/empty/empty-tag/dup", () => {
  assert.deepEqual(parseExpectedPending(" a , b ,c").tags, ["a", "b", "c"]);
  assert.equal(parseExpectedPending(undefined).ok, false);
  assert.equal(parseExpectedPending("").ok, false);
  assert.equal(parseExpectedPending("a,,b").ok, false);
  assert.equal(parseExpectedPending("a,b,a").ok, false);
});

// ─────────────────────── pure: validateExpectedPendingLocally ────────────────
test("validateExpectedPendingLocally: trailing in-order slice accepted", () => {
  assert.equal(validateExpectedPendingLocally(["m2", "m3"], ["m0", "m1", "m2", "m3"]).ok, true);
});
test("validateExpectedPendingLocally: unknown / gap / reorder / whole-journal rejected", () => {
  assert.equal(validateExpectedPendingLocally(["m9"], ["m0", "m1"]).ok, false);
  assert.equal(validateExpectedPendingLocally(["m1", "m3"], ["m0", "m1", "m2", "m3"]).ok, false);
  assert.equal(validateExpectedPendingLocally(["m3", "m2"], ["m0", "m1", "m2", "m3"]).ok, false);
  assert.equal(validateExpectedPendingLocally(["m0", "m1"], ["m0", "m1"]).ok, false);
});
test("validateExpectedPendingLocally: HEAD journal (ends 0034) + expected 0031..0033 → rejected", () => {
  const head = ["0031_stiff_leech", "0032_cool_red_wolf", "0033_reflective_wolf_cub", "0034_aberrant_earthquake"];
  assert.equal(validateExpectedPendingLocally(head.slice(0, 3), head).ok, false);
});

// ──────────────────── pure: computeCleanPrefixAndPending ─────────────────────
test("computeCleanPrefixAndPending: exact prefix → ordered pending, zero hash mismatch", () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const r = computeCleanPrefixAndPending({
    journal: j, recordedRows: [{ hash: "h_m0", created_at: 100 }, { hash: "h_m1", created_at: 200 }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.prefixLen, 2);
  assert.deepEqual(r.pendingTags, ["m2", "m3"]);
  assert.equal(r.hashMismatchCount, 0);
  assert.deepEqual(r.hashMismatches, []);
});
test("computeCleanPrefixAndPending: empty metadata refused unless allowEmptyPrefix", () => {
  const j = fakeJournal(["m0", "m1"]);
  assert.equal(computeCleanPrefixAndPending({ journal: j, recordedRows: [] }).ok, false);
  assert.equal(computeCleanPrefixAndPending({ journal: j, recordedRows: [], allowEmptyPrefix: true }).ok, true);
});
test("computeCleanPrefixAndPending: missing interior / unknown / duplicate / over-length refused", () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  assert.equal(computeCleanPrefixAndPending({ journal: j, recordedRows: [{ created_at: 100 }, { created_at: 300 }] }).ok, false);
  assert.equal(computeCleanPrefixAndPending({ journal: j, recordedRows: [{ created_at: 100 }, { created_at: 250 }] }).ok, false);
  assert.equal(computeCleanPrefixAndPending({ journal: j, recordedRows: [{ created_at: 100 }, { created_at: 100 }] }).ok, false);
  assert.equal(
    computeCleanPrefixAndPending({ journal: fakeJournal(["m0"]), recordedRows: [{ created_at: 100 }, { created_at: 200 }] }).ok,
    false,
  );
  assert.equal(computeCleanPrefixAndPending({ journal: j, recordedRows: [{ created_at: "x" }] }).ok, false);
});
test("computeCleanPrefixAndPending: prefix hash divergence is reported with tags, not fatal", () => {
  const j = fakeJournal(["m0", "m1", "m2"]);
  const r = computeCleanPrefixAndPending({
    journal: j,
    recordedRows: [{ hash: "AAAAAAAAAAAAAAAA", created_at: 100 }, { hash: "h_m1", created_at: 200 }],
  });
  assert.equal(r.ok, true);
  assert.equal(r.hashMismatchCount, 1);
  assert.equal(r.hashMismatches[0].tag, "m0");
  assert.equal(r.hashMismatches[0].recorded, "AAAAAAAAAAAA");
  assert.equal(r.hashMismatches[0].local, "h_m0");
});

// ─────────────────────── pure: assertExpectedEqualsObserved ──────────────────
test("assertExpectedEqualsObserved: equal / length / order", () => {
  assert.equal(assertExpectedEqualsObserved(["a", "b"], ["a", "b"]).ok, true);
  assert.equal(assertExpectedEqualsObserved(["a"], ["a", "b"]).ok, false);
  assert.equal(assertExpectedEqualsObserved(["a", "b"], ["b", "a"]).ok, false);
});

// ─────────────────────────── pure: resolveMigrationsFolder ───────────────────
test("resolveMigrationsFolder: default / empty / NUL / explicit", () => {
  assert.deepEqual(resolveMigrationsFolder(undefined), { ok: true, folder: DEFAULT_MIGRATIONS_FOLDER });
  assert.equal(resolveMigrationsFolder("").ok, false);
  assert.equal(resolveMigrationsFolder("db/\0evil").ok, false);
  assert.deepEqual(resolveMigrationsFolder("db/pinned-0033"), { ok: true, folder: "db/pinned-0033" });
});

// ─────────────────────────── pure: staticPreConnectionGate ───────────────────
test("staticPreConnectionGate: test mode requires 127.0.0.1 and no prod signature", () => {
  const j = fakeJournal(["m0", "m1"]);
  assert.equal(staticPreConnectionGate({ connectionString: "postgresql://x@127.0.0.1:5599/d", testMode: true, journal: j }).ok, true);
  assert.equal(staticPreConnectionGate({ connectionString: "postgresql://x@10.0.0.5:5599/d", testMode: true, journal: j }).ok, false);
  assert.equal(staticPreConnectionGate({ connectionString: "postgresql://zmndhiujxfxncebezxhb@127.0.0.1:5599/d", testMode: true, journal: j }).ok, false);
});
test("staticPreConnectionGate: production needs signature + expected-db + expected-pending", () => {
  const j = fakeJournal(["m0", "m1", "m2"]);
  assert.equal(staticPreConnectionGate({ connectionString: "postgresql://u@some-host:5432/d", testMode: false, expectedDb: "d", expectedPending: ["m2"], journal: j }).ok, false);
  assert.equal(staticPreConnectionGate({ connectionString: PROD_URL, testMode: false, expectedPending: ["m2"], journal: j }).ok, false);
  assert.equal(staticPreConnectionGate({ connectionString: PROD_URL, testMode: false, expectedDb: "d", journal: j }).ok, false);
  assert.equal(staticPreConnectionGate({ connectionString: PROD_URL, testMode: false, expectedDb: "d", expectedPending: ["m2"], journal: j }).ok, true);
});
test("staticPreConnectionGate: RBAC migration pending but seed missing → refused", () => {
  const j = fakeJournal(["m0", RBAC_SEED_MIGRATION_TAG], { rbacSeedOk: false });
  assert.equal(
    staticPreConnectionGate({ connectionString: PROD_URL, testMode: false, expectedDb: "d", expectedPending: [RBAC_SEED_MIGRATION_TAG], journal: j }).ok,
    false,
  );
});

// ─────────────────────────── real FS (read-only) ─────────────────────────────
test("readMigrationJournal: committed db/migrations journal valid; 38 entries; identity + fingerprint present", () => {
  const j = readMigrationJournal();
  assert.equal(j.tags.length, 38);
  assert.equal(j.tags[j.tags.length - 1], "0037_amused_justin_hammer");
  j.entries.forEach((e, i) => assert.equal(e.idx, i));
  assert.equal(j.rbacSeedMigrationPresent, true);
  assert.equal(j.rbacSeedOk, true);
  assert.equal(j.fingerprint.length, 64);
  assert.match(j.identity, /0034_aberrant_earthquake/);
});
test("readMigrationJournal: malformed journals rejected (idx / when / missing sql)", () => {
  const idxBad = (p) => (p.endsWith("_journal.json") ? JSON.stringify({ entries: [{ idx: 0, tag: "a", when: 1 }, { idx: 2, tag: "b", when: 2 }] }) : "-- sql");
  assert.throws(() => readMigrationJournal({ readFileFn: idxBad }), /not contiguous/);
  const whenBad = (p) => (p.endsWith("_journal.json") ? JSON.stringify({ entries: [{ idx: 0, tag: "a", when: 5 }, { idx: 1, tag: "b", when: 5 }] }) : "-- sql");
  assert.throws(() => readMigrationJournal({ readFileFn: whenBad }), /strictly increasing/);
  const sqlMissing = (p) => { if (p.endsWith("_journal.json")) return JSON.stringify({ entries: [{ idx: 0, tag: "a", when: 1 }] }); throw new Error("ENOENT"); };
  assert.throws(() => readMigrationJournal({ readFileFn: sqlMissing }), /not readable/);
});

// ─────────────────────────── run(): no-connection paths ──────────────────────
test("A. default inspection opens NO connection, never calls migrate(), prints the full fingerprint", async () => {
  const out = collect();
  let connected = false;
  const j = fakeJournal(["m0", "m1"]);
  const r = await run({
    argv: [], env: {}, readJournalFn: journalFn(j),
    connectFn: async () => { connected = true; throw new Error("must not connect"); },
    migrateFn: async () => assert.fail("migrate must not run"),
    log: out.sink, error: out.sink,
  });
  assert.equal(connected, false);
  assert.equal(r.mode, "inspection");
  assert.equal(r.fingerprint, FP);
  assert.match(out.text(), /NOT drizzle-kit push/);
  assert.match(out.text(), /NOT self-derived/);
  assert.match(out.text(), new RegExp(FP));
});

test("malformed CLI: a flag present without a value fails loudly, zero connection", async () => {
  for (const argv of [["--apply", "--expected-db"], ["--apply", "--migrations-folder", "--expected-db", "x"], ["--apply", "--expected-fingerprint"], ["--apply", "--expected-pending"]]) {
    const r = await run({ argv, env: PROD_ENV(), readJournalFn: journalFn(fakeJournal(["m0", "m1", "m2"])), connectFn: async () => assert.fail("no connect"), log: () => {}, error: () => {} });
    assert.equal(r.refused, true, JSON.stringify(argv));
    assert.match(r.reason, /present without a value/);
  }
});

const noConnect = () => async () => assert.fail("must not connect");

test("E. bad migrations folder → refused, zero connection", async () => {
  const r = await run({ argv: ["--apply", "--migrations-folder", ""], env: PROD_ENV(), connectFn: noConnect(), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
});
test("F. malformed journal → refused, zero connection", async () => {
  const r = await run({ argv: ["--apply"], env: PROD_ENV(), readJournalFn: () => { throw new Error("bad journal"); }, connectFn: noConnect(), log: () => {}, error: () => {} });
  assert.equal(r.refused, true);
  assert.equal(r.reason, "journal invalid");
});
test("G/H/I. unknown / duplicate / out-of-order --expected-pending → refused, zero connection", async () => {
  const j = journalFn(fakeJournal(["m0", "m1", "m2"]));
  for (const ep of ["nope", "m2,m2", "m2,m1"]) {
    const r = await run({ argv: ["--apply", "--expected-pending", ep, "--expected-db", "proddb", "--expected-fingerprint", FP], env: PROD_ENV(), readJournalFn: j, realpathFn: RP_OK, connectFn: noConnect(), log: () => {}, error: () => {} });
    assert.equal(r.refused, true, ep);
  }
});
test("B/C/D. static gate: bad signature / missing expected-db / missing expected-pending → refused, zero connection", async () => {
  const j = journalFn(fakeJournal(["m0", "m1", "m2"]));
  const badSig = await run({ argv: ["--apply", "--expected-pending", "m2", "--expected-db", "d", "--expected-fingerprint", FP], env: { DATABASE_URL: "postgresql://u:p@random-host:5432/d", RBAC_BOOTSTRAP_TARGET: "production-main" }, readJournalFn: j, realpathFn: RP_OK, connectFn: noConnect(), log: () => {}, error: () => {} });
  assert.equal(badSig.refused, true);
  const noDb = await run({ argv: ["--apply", "--expected-pending", "m2", "--expected-fingerprint", FP], env: PROD_ENV(), readJournalFn: j, realpathFn: RP_OK, connectFn: noConnect(), log: () => {}, error: () => {} });
  assert.equal(noDb.refused, true);
  const noPending = await run({ argv: ["--apply", "--expected-db", "proddb", "--expected-fingerprint", FP], env: PROD_ENV(), readJournalFn: j, realpathFn: RP_OK, connectFn: noConnect(), log: () => {}, error: () => {} });
  assert.equal(noPending.refused, true);
});

// ─────────────────────── run(): FINDING A — expected-fingerprint ─────────────
test("production --apply requires --expected-fingerprint → refused before connection when missing", async () => {
  const r = await run({
    argv: ["--apply", "--expected-pending", "m2,m3", "--expected-db", "proddb"],
    env: PROD_ENV(), readJournalFn: journalFn(fakeJournal(["m0", "m1", "m2", "m3"])),
    realpathFn: RP_OK, connectFn: noConnect(), log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(r.staticGate, false);
  assert.match(r.reason, /--expected-fingerprint <sha256> is required/);
});
test("malformed --expected-fingerprint → refused before connection", async () => {
  const r = await run({
    argv: ["--apply", "--expected-pending", "m2,m3", "--expected-db", "proddb", "--expected-fingerprint", "not-hex"],
    env: PROD_ENV(), readJournalFn: journalFn(fakeJournal(["m0", "m1", "m2", "m3"])),
    realpathFn: RP_OK, connectFn: noConnect(), log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.match(r.reason, /64-hex-character SHA-256/);
});
test("--expected-fingerprint mismatch vs folder fingerprint → refused before connection", async () => {
  const r = await run({
    argv: ["--apply", "--expected-pending", "m2,m3", "--expected-db", "proddb", "--expected-fingerprint", "a".repeat(64)],
    env: PROD_ENV(), readJournalFn: journalFn(fakeJournal(["m0", "m1", "m2", "m3"])),
    realpathFn: RP_OK, connectFn: noConnect(), log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(r.staticGate, false);
  assert.match(r.reason, /does not match the selected folder fingerprint/);
});
test("correct --expected-fingerprint passes the static gate and proceeds", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "h_m0", created_at: 100 }, { hash: "h_m1", created_at: 200 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [300, 400]), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.mutated, true);
  assert.deepEqual(r.appliedPending, ["m2", "m3"]);
});

// ─────────────────── run(): FINDING A — trusted folder boundary ──────────────
test("production folder that resolves OUTSIDE <repo>/db → refused, zero connection", async () => {
  const r = await run({
    argv: ["--apply", "--expected-pending", "m2,m3", "--expected-db", "proddb", "--expected-fingerprint", FP],
    env: PROD_ENV(), readJournalFn: journalFn(fakeJournal(["m0", "m1", "m2", "m3"])),
    realpathFn: RP_ESCAPE, connectFn: noConnect(), log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(r.staticGate, false);
  assert.match(r.reason, /OUTSIDE the trusted production migration boundary/);
});
test("test-disposable mkdtemp folder is NOT subject to the trusted-folder boundary", async () => {
  const j = fakeJournal(["m0", "m1", "m2"]);
  const fake = makeFakeConn({ currentDb: "testdb", reg: null });
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://x:y@127.0.0.1:5599/testdb", "--migrations-folder", "/tmp/pm-xxxxx/mig"],
    env: { RBAC_MIG_TEST_MODE: "1" }, readJournalFn: journalFn(j),
    realpathFn: () => assert.fail("realpath must not be consulted in test mode"),
    connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [100, 200, 300]),
    promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {},
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(r.classification, "TEST-DISPOSABLE");
});

// ─────────────────────────── run(): connected happy paths ────────────────────
test("production apply happy path: clean prefix, exact expected set, migrate once, structural verify absent (non-CRM tags)", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "h_m0", created_at: 100 }, { hash: "h_m1", created_at: 200 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [300, 400]), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.ok, true);
  assert.equal(r.mutated, true);
  assert.equal(r.classification, "PRODUCTION-MAIN");
  assert.deepEqual(r.post.structural, []);
  assert.equal(fake.state.migrateCalled, 1);
});

test("RBAC apply happy path: 0034 in pending → staff_roles seed verified via the registry", async () => {
  const j = fakeJournal(["m0", "m1", RBAC_SEED_MIGRATION_TAG]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "h_m0", created_at: 100 }, { hash: "h_m1", created_at: 200 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", RBAC_SEED_MIGRATION_TAG, "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [300]), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.roleRows, ["ADMIN", "EMPLOYEE", "MANAGER", "OWNER"]);
  assert.equal(r.post.structural[0].tag, RBAC_SEED_MIGRATION_TAG);
  assert.equal(r.post.structural[0].ok, true);
});

// ─────────────────── run(): FINDING E — CRM structural post-verify ───────────
const CRM_TAGS = ["0031_stiff_leech", "0032_cool_red_wolf", "0033_reflective_wolf_cub"];
function crmRun({ structural = {}, migrateWraps } = {}) {
  const j = fakeJournal(["m0", ...CRM_TAGS]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "h_m0", created_at: 100 }]], structural });
  const baseMigrate = fakeMigrate(fake, j, [200, 300, 400]);
  return {
    fake,
    promise: prodRun({
      argv: ["--expected-pending", CRM_TAGS.join(","), "--expected-db", "proddb"],
      journal: j, connectFn: async () => fake.conn,
      migrateFn: migrateWraps ? migrateWraps(baseMigrate, fake) : baseMigrate,
      promptFn: async () => CONFIRMATION_TOKEN,
    }),
  };
}
test("CRM 0031/0032/0033 structural verifiers all pass → run ok, structural entries reported", async () => {
  const { promise } = crmRun();
  const r = await promise;
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.deepEqual(r.post.structural.map((s) => `${s.tag}:${s.ok}`), CRM_TAGS.map((t) => `${t}:true`));
});
test("CRM structural verify FAILS (0031 missing FK) → verifyFailed, mutated true, not reported as success", async () => {
  const { promise } = crmRun({ structural: { link_fk: 0 } });
  const r = await promise;
  assert.equal(r.ok, false);
  assert.equal(r.verifyFailed, true);
  assert.equal(r.mutated, true);
});
test("CRM structural verify FAILS (0032 do_not_contact not NOT NULL) → verifyFailed", async () => {
  const { promise } = crmRun({ structural: { dnc_notnull: 0 } });
  const r = await promise;
  assert.equal(r.verifyFailed, true);
});
test("CRM structural verify FAILS (0033 missing a column) → verifyFailed", async () => {
  const { promise } = crmRun({ structural: { interaction_cols: 1 } });
  const r = await promise;
  assert.equal(r.verifyFailed, true);
});
test("STRUCTURAL_VERIFIERS registry has entries for exactly the five known tags", () => {
  assert.deepEqual(
    Object.keys(STRUCTURAL_VERIFIERS).sort(),
    [...CRM_TAGS, RBAC_SEED_MIGRATION_TAG, "0035_tough_phil_sheldon"].sort(),
  );
});

// ─────────────────── run(): FINDING C — prefix hash drift ────────────────────
function driftConn() {
  return makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "DIFFERENT_HASH", created_at: 100 }, { hash: "h_m1", created_at: 200 }]] });
}
test("prefix hash drift, production, NO acknowledgement → refused before MIGRATE", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = driftConn();
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.refused, true);
  assert.match(r.reason, /prefix hash drift .* is not acknowledged/);
  assert.equal(fake.state.migrateCalled, 0);
});
test("prefix hash drift, production, WITH acknowledgement → proceeds to migrate", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = driftConn();
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb", PREFIX_HASH_DRIFT_FLAG],
    journal: j, connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [300, 400]), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fake.state.migrateCalled, 1);
});
test("prefix hash drift, TEST-DISPOSABLE → permissive (no acknowledgement needed)", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "testdb", datasets: [[{ hash: "DIFFERENT", created_at: 100 }, { hash: "h_m1", created_at: 200 }]] });
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://x:y@127.0.0.1:5599/testdb", "--expected-pending", "m2,m3"],
    env: { RBAC_MIG_TEST_MODE: "1" }, readJournalFn: journalFn(j),
    connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [300, 400]), promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {}, error: () => {},
  });
  assert.equal(r.ok, true, JSON.stringify(r));
});
test("multiple prefix hash mismatches, production, WITH acknowledgement → proceeds", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "X1", created_at: 100 }, { hash: "X2", created_at: 200 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb", PREFIX_HASH_DRIFT_FLAG],
    journal: j, connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [300, 400]), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.ok, true);
});
test("acknowledgement does NOT bypass the expected==observed gate", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  // DB prefix [m0,m1] → observed pending [m2,m3]; expected [m1,m2,m3] (valid suffix) → mismatch
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "X1", created_at: 100 }, { hash: "X2", created_at: 200 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m1,m2,m3", "--expected-db", "proddb", PREFIX_HASH_DRIFT_FLAG],
    journal: j, connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.refused, true);
  assert.match(r.reason, /does not equal the target's actual pending set/);
});
test("acknowledgement does NOT bypass the --expected-fingerprint match", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const r = await run({
    argv: ["--apply", "--expected-pending", "m2,m3", "--expected-db", "proddb", "--expected-fingerprint", "a".repeat(64), PREFIX_HASH_DRIFT_FLAG],
    env: PROD_ENV(), readJournalFn: journalFn(j), realpathFn: RP_OK, connectFn: noConnect(), log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.match(r.reason, /does not match the selected folder fingerprint/);
});

// ─────────────────── run(): FINDING B — artifact TOCTOU recheck ──────────────
function toctrunBase(journals, { migrateFn, promptFn = async () => CONFIRMATION_TOKEN } = {}) {
  const fake = makeFakeConn({ currentDb: "testdb", datasets: [[{ created_at: 100 }, { created_at: 200 }]] });
  return {
    fake,
    promise: run({
      argv: ["--apply", "--db-url", "postgresql://x:y@127.0.0.1:5599/testdb", "--expected-pending", "m2,m3"],
      env: { RBAC_MIG_TEST_MODE: "1" }, readJournalFn: statefulJournalFn(journals),
      connectFn: async () => fake.conn, migrateFn: migrateFn ?? (async () => assert.fail("must not migrate")),
      promptFn, log: () => {}, error: () => {},
    }),
  };
}
test("artifact unchanged between validation and migrate() → allowed", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "testdb", datasets: [[{ created_at: 100 }, { created_at: 200 }]] });
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://x:y@127.0.0.1:5599/testdb", "--expected-pending", "m2,m3"],
    env: { RBAC_MIG_TEST_MODE: "1" }, readJournalFn: statefulJournalFn([j, j]),
    connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [300, 400]), promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {}, error: () => {},
  });
  assert.equal(r.ok, true, JSON.stringify(r));
  assert.equal(fake.state.migrateCalled, 1);
});
test("SQL content changed after the prompt (fingerprint differs) → migrateFn NOT called", async () => {
  const j1 = fakeJournal(["m0", "m1", "m2", "m3"], { fingerprint: FP });
  const j2 = fakeJournal(["m0", "m1", "m2", "m3"], { fingerprint: "e".repeat(64) });
  const { fake, promise } = toctrunBase([j1, j2]);
  const r = await promise;
  assert.equal(r.refused, true);
  assert.match(r.reason, /migration artifact changed/);
  assert.equal(fake.state.migrateCalled, 0);
});
test("journal identity changed after the prompt (same fingerprint) → migrateFn NOT called", async () => {
  const j1 = fakeJournal(["m0", "m1", "m2", "m3"]);
  const j2 = fakeJournal(["m0", "m1", "m2", "m3"], { identity: "TAMPERED" });
  const { fake, promise } = toctrunBase([j1, j2]);
  const r = await promise;
  assert.equal(r.refused, true);
  assert.equal(fake.state.migrateCalled, 0);
});
test("artifact re-read throws after the prompt → refused, migrateFn NOT called", async () => {
  const j1 = fakeJournal(["m0", "m1", "m2", "m3"]);
  let n = 0;
  const fake = makeFakeConn({ currentDb: "testdb", datasets: [[{ created_at: 100 }, { created_at: 200 }]] });
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://x:y@127.0.0.1:5599/testdb", "--expected-pending", "m2,m3"],
    env: { RBAC_MIG_TEST_MODE: "1" },
    readJournalFn: () => { if (n++ === 0) return j1; throw new Error("artifact vanished"); },
    connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"),
    promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(fake.state.migrateCalled, 0);
});
test("production: artifact fingerprint changes between validation and migrate() → refused", async () => {
  const j1 = fakeJournal(["m0", "m1", "m2", "m3"], { fingerprint: FP });
  const j2 = fakeJournal(["m0", "m1", "m2", "m3"], { fingerprint: "d".repeat(64) });
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "h_m0", created_at: 100 }, { hash: "h_m1", created_at: 200 }]] });
  const r = await run({
    argv: ["--apply", "--expected-pending", "m2,m3", "--expected-db", "proddb", "--expected-fingerprint", FP],
    env: PROD_ENV(), readJournalFn: statefulJournalFn([j1, j2]), realpathFn: RP_OK,
    connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"),
    promptFn: async () => CONFIRMATION_TOKEN, log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(fake.state.migrateCalled, 0);
});

// ─────────────────────── run(): other connected gates ───────────────────────
test("equality gate: expected set differs from observed pending → refused before mutation", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ created_at: 100 }, { created_at: 200 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m1,m2,m3", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.refused, true);
  assert.equal(fake.state.migrateCalled, 0);
});
test("metadata absent + PRODUCTION-MAIN → refused, no mutation", async () => {
  const j = fakeJournal(["m0", "m1", "m2"]);
  const fake = makeFakeConn({ currentDb: "proddb", reg: null });
  const r = await prodRun({
    argv: ["--expected-pending", "m1,m2", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.refused, true);
  assert.match(r.reason, /does not exist on the target/);
});
test("metadata non-prefix (missing interior row) → refused, no mutation", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ created_at: 100 }, { created_at: 300 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.refused, true);
});
test("R. current_database() != --expected-db → refused before mutation", async () => {
  const j = fakeJournal(["m0", "m1", "m2"]);
  const fake = makeFakeConn({ currentDb: "WRONG", datasets: [[{ created_at: 100 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m1,m2", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.refused, true);
  assert.equal(fake.state.migrateCalled, 0);
});
test("S. confirmation token withheld → zero mutation", async () => {
  const j = fakeJournal(["m0", "m1", "m2"]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ created_at: 100 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m1,m2", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate"), promptFn: async () => "no",
  });
  assert.equal(r.cancelled, true);
  assert.equal(fake.state.migrateCalled, 0);
});
test("DB change-window: prefix advanced between preflight and migrate → refused, no mutation", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({
    currentDb: "proddb",
    datasets: [[{ created_at: 100 }, { created_at: 200 }], [{ created_at: 100 }, { created_at: 200 }, { created_at: 300 }]],
  });
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not migrate after a changed window"), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.refused, true);
  assert.match(r.reason, /change window/);
  assert.equal(fake.state.migrateCalled, 0);
});

// ─────────────────── run(): FINDING 9 — error sanitization ───────────────────
test("migrate() throws → migrationFailed, mutated false, reason carries no connection string", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "h_m0", created_at: 100 }, { hash: "h_m1", created_at: 200 }]] });
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn,
    migrateFn: async () => { throw new Error("boom at postgresql://secretuser:secretpw@host/db"); },
    promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.ok, false);
  assert.equal(r.migrationFailed, true);
  assert.equal(r.mutated, false);
  assert.doesNotMatch(r.reason, /secretuser|secretpw/);
  assert.doesNotMatch(r.reason, /postgres(ql)?:\/\//i);
});
test("preflight throws unexpectedly → refused (not migrationFailed), mutated false, sanitized", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const conn = {
    query: async (sql) => {
      if (/^BEGIN READ ONLY/i.test(sql)) throw new Error("kaboom //u:p@h/db password=hunter2");
      return { rows: [] };
    },
    drizzle: {}, end: async () => {},
  };
  const r = await prodRun({
    argv: ["--expected-pending", "m2,m3", "--expected-db", "proddb"],
    journal: j, connectFn: async () => conn, migrateFn: async () => assert.fail("must not migrate"), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.refused, true);
  assert.equal(r.phase, "preflight");
  assert.doesNotMatch(r.reason, /hunter2/);
  assert.doesNotMatch(r.reason, /\/\/u:p@/);
});
test("postVerify throws after migrate() committed → verifyFailed, mutated TRUE, not success", async () => {
  const j = fakeJournal(["m0", ...CRM_TAGS]);
  const fake = makeFakeConn({ currentDb: "proddb", datasets: [[{ hash: "h_m0", created_at: 100 }]] });
  const orig = fake.conn.query;
  fake.conn.query = async (sql) => {
    if (/as client_cols/i.test(sql)) throw new Error("verifier query blew up");
    return orig(sql);
  };
  const r = await prodRun({
    argv: ["--expected-pending", CRM_TAGS.join(","), "--expected-db", "proddb"],
    journal: j, connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [200, 300, 400]), promptFn: async () => CONFIRMATION_TOKEN,
  });
  assert.equal(r.ok, false);
  assert.equal(r.verifyFailed, true);
  assert.equal(r.mutated, true);
});

// ─────────────────── run(): test-disposable convenience / noop ───────────────
test("test-disposable convenience: fresh DB (no metadata) + no --expected-pending → full replay", async () => {
  const j = fakeJournal(["m0", "m1", "m2"]);
  const fake = makeFakeConn({ currentDb: "testdb", reg: null });
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://x:y@127.0.0.1:5599/testdb"],
    env: { RBAC_MIG_TEST_MODE: "1" }, readJournalFn: journalFn(j),
    connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [100, 200, 300]), promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {}, error: () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.mutated, true);
  assert.equal(r.classification, "TEST-DISPOSABLE");
});
test("T. rerun after success: everything applied + explicit non-empty --expected-pending → refused", async () => {
  const j = fakeJournal(["m0", "m1", "m2", "m3"]);
  const fake = makeFakeConn({ currentDb: "testdb", datasets: [[{ created_at: 100 }, { created_at: 200 }, { created_at: 300 }, { created_at: 400 }]] });
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://x:y@127.0.0.1:5599/testdb", "--expected-pending", "m2,m3"],
    env: { RBAC_MIG_TEST_MODE: "1" }, readJournalFn: journalFn(j),
    connectFn: async () => fake.conn, migrateFn: async () => assert.fail("must not re-run"), promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {}, error: () => {},
  });
  assert.equal(r.refused, true);
  assert.equal(fake.state.migrateCalled, 0);
});
test("noop: everything applied + test-mode convenience → clean no-op", async () => {
  const j = fakeJournal(["m0", "m1"]);
  const fake = makeFakeConn({ currentDb: "testdb", datasets: [[{ created_at: 100 }, { created_at: 200 }]] });
  const r = await run({
    argv: ["--apply", "--db-url", "postgresql://x:y@127.0.0.1:5599/testdb"],
    env: { RBAC_MIG_TEST_MODE: "1" }, readJournalFn: journalFn(j),
    connectFn: async () => fake.conn, migrateFn: async () => assert.fail("nothing to do"), promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {}, error: () => {},
  });
  assert.equal(r.ok, true);
  assert.equal(r.mode, "noop");
  assert.equal(r.mutated, false);
});

test("redaction: no output line ever contains the raw connection string or credentials", async () => {
  const out = collect();
  const j = fakeJournal(["m0", "m1", "m2"]);
  const fake = makeFakeConn({ currentDb: "public_map_prod", datasets: [[{ created_at: 100 }]] });
  await run({
    argv: ["--apply", "--expected-pending", "m1,m2", "--expected-db", "public_map_prod", "--expected-fingerprint", FP],
    env: { DATABASE_URL: "postgresql://secretuser:secretpw@db.zmndhiujxfxncebezxhb.supabase.co:5432/public_map_prod", RBAC_BOOTSTRAP_TARGET: "production-main" },
    readJournalFn: journalFn(j), realpathFn: RP_OK,
    connectFn: async () => fake.conn, migrateFn: fakeMigrate(fake, j, [200, 300]), promptFn: async () => CONFIRMATION_TOKEN,
    log: out.sink, error: out.sink,
  });
  assert.doesNotMatch(out.text(), /secretuser|secretpw/);
  assert.doesNotMatch(out.text(), /postgres(ql)?:\/\//i);
});
