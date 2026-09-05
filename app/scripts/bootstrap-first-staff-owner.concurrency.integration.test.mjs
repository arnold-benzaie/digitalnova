// PHASE RBAC-BOOTSTRAP-CONCURRENCY-HARDENING-1 — disposable-container
// integration tests proving the workspace-scoped pg_advisory_xact_lock in
// scripts/bootstrap-first-staff-owner.mjs actually serializes concurrent
// OWNER bootstrap attempts for the SAME internal workspace.
//
// Spins its OWN ephemeral postgres:16-alpine (random name + port, --rm,
// destroyed in `after`) — the exact pattern of
// scripts/rbac-mig-tooling.integration.test.mjs. NEVER touches
// Preview/Production or any remote host. Every concurrent invocation
// drives a REAL, independent `pg.Client` against the REAL bootstrap
// implementation — nothing about its SQL or control flow is
// reimplemented or mocked. The "different OWNER" test additionally wraps
// the transport (not the implementation) in a small test-only rendezvous
// barrier (see `makeBarrier` / `barrierConnectFn` below) so both
// invocations are DETERMINISTICALLY forced to reach the
// pg_advisory_xact_lock statement at the same real time, rather than
// relying on Promise.all scheduling luck — see
// RBAC-BOOTSTRAP-CONCURRENCY-TEST-FIX-1 for why that mattered: the prior
// Promise.all-only version of this test passed 6/6 times even against a
// scratch copy with the lock removed, because the pre-existing
// post-insert verification already happened to catch the race under
// normal local-disposable-DB timing. The barrier closes that gap; see
// the negative-control evidence recorded in RBAC-BOOTSTRAP-PROCEDURE.md.
//
// Requires Docker. Run:
//   npx tsx --test scripts/bootstrap-first-staff-owner.concurrency.integration.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool, Client } from "pg";

import { run as runMigrate } from "./db-migrate.mjs";
import { run as runBootstrap } from "./bootstrap-first-staff-owner.mjs";

const CONTAINER = `pm-rbac-bootstrap-concurrency-${randomUUID().slice(0, 8)}`;
const HOST_PORT = 5700 + Math.floor(Math.random() * 60); // 5700-5759 — clear of every other suite's range
const PG_USER = "rbac_bootstrap_concurrency";
const PG_PASSWORD = "rbac_bootstrap_concurrency_local_only";
const PG_DB = "rbac_bootstrap_concurrency_check";
const URL = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${HOST_PORT}/${PG_DB}`;

if (/supabase|neon|pooler/i.test(URL) || !/@127\.0\.0\.1:/.test(URL)) {
  throw new Error("REFUS : cible non locale. Arret avant tout demarrage de conteneur.");
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const TEST_ENV = { RBAC_MIG_TEST_MODE: "1" };
const silent = { log: () => {}, error: () => {} };

const ORG = randomUUID();
const OWNER_A = randomUUID();
const OWNER_B = randomUUID();
const ADMIN_1 = randomUUID();
const ADMIN_2 = randomUUID();

let pool;
let containerStarted = false;
const client = { query: (...a) => pool.query(...a) };

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
  const { rows } = await pool.query("select current_database() as db");
  assert.equal(rows[0].db, PG_DB);

  // Schema + closed staff_roles catalogue via the reviewed migrator (test mode).
  const rMig = await runMigrate({ argv: ["--apply", "--db-url", URL], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
  assert.equal(rMig.ok, true, `migrate failed: ${JSON.stringify(rMig)}`);

  // Legacy fixtures: one internal org, two distinct eligible OWNER candidates (both legacy "admin", active).
  const ROLE_ADMIN_LEGACY = randomUUID();
  await client.query("insert into roles (id, name) values ($1,'admin') on conflict (name) do nothing", [ROLE_ADMIN_LEGACY]);
  const adminRoleId = (await client.query("select id from roles where name='admin'")).rows[0].id;
  await client.query("insert into organizations (id, name, is_internal) values ($1,'PUBLIC-MAP internal',true)", [ORG]);
  for (const [id, email] of [
    [OWNER_A, "owner-a@public-map.com"],
    [OWNER_B, "owner-b@public-map.com"],
    [ADMIN_1, "admin1@public-map.com"],
    [ADMIN_2, "admin2@public-map.com"],
  ]) {
    await client.query("insert into users (id, clerk_user_id, email, status) values ($1,$2,$3,'active')", [id, `clerk_${id}`, email]);
    await client.query("insert into memberships (user_id, organization_id, role_id) values ($1,$2,$3)", [id, ORG, adminRoleId]);
  }
});

after(async () => {
  await pool?.end().catch(() => {});
  if (containerStarted) sh("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

async function countStaff() {
  const { rows } = await client.query(
    "select sm.user_id, sr.name as role, sm.status from staff_members sm join staff_roles sr on sr.id = sm.role_id order by sr.name, sm.user_id",
  );
  return rows;
}

/**
 * A minimal N-party rendezvous barrier: `arrive()` blocks every caller
 * until exactly `n` callers have called it, then releases all of them at
 * once. Used to force two independent bootstrap invocations to reach the
 * SAME statement (the advisory-lock acquisition) at the same real time,
 * rather than hoping `Promise.all` scheduling luck produces that overlap.
 * Test-only — never imported by, or contaminating, production code.
 */
function makeBarrier(n) {
  let arrived = 0;
  let release;
  const everyoneArrived = new Promise((resolve) => { release = resolve; });
  return {
    arrive: async () => {
      arrived += 1;
      if (arrived >= n) release();
      await everyoneArrived;
    },
  };
}

/**
 * A connectFn that opens a REAL pg.Client (the actual production code
 * path, `bootstrap-first-staff-owner.mjs`'s own SQL — nothing about the
 * implementation is reimplemented or mocked here) and, the FIRST time a
 * query matching `sqlPattern` is about to be sent, makes the caller
 * `arrive()` at `barrier` before letting that exact query reach Postgres.
 * This guarantees genuine overlap at the precise critical-section
 * boundary regardless of any timing variance in everything that happens
 * before it (connect, identity resolution, the pre-BEGIN fast path, …).
 */
function barrierConnectFn(barrier, sqlPattern) {
  return async (connectionString) => {
    const real = new Client({ connectionString });
    await real.connect();
    let armed = true;
    return {
      query: async (sql, params) => {
        if (armed && sqlPattern.test(sql)) {
          armed = false; // only the first match synchronizes
          await barrier.arrive();
        }
        return real.query(sql, params);
      },
      end: () => real.end(),
    };
  };
}

const LOCK_ACQUIRE_SQL = /pg_advisory_xact_lock/i;

// ---------------------------------------------------------------
// Phase 7 — two DIFFERENT eligible OWNER candidates, with DETERMINISTIC
// synchronization at the lock-acquisition boundary (not Promise.all
// timing luck). If either invocation's real production code path never
// reaches the pg_advisory_xact_lock statement, the OTHER invocation's
// barrier.arrive() call blocks forever — the bounded race against a
// timeout below turns that into a clear test failure ("never reached the
// lock together") rather than a silent pass or a hang.
test("concurrent bootstrap: two DIFFERENT OWNER candidates for the SAME workspace — deterministic barrier at lock acquisition", async () => {
  const manifestFor = (ownerId, adminId) => () => ({
    ownerUserId: ownerId,
    adminUserIds: adminId ? [adminId] : [],
    expectedWorkspaceOrgId: ORG,
    expectedDbName: PG_DB,
  });

  const barrier = makeBarrier(2);

  const invoke = (ownerId, adminId) =>
    runBootstrap({
      argv: ["--manifest", "x", "--db-url", URL, "--apply", "--confirm-owner-id", ownerId],
      env: TEST_ENV,
      // The REAL bootstrap implementation is exercised end-to-end here —
      // only the transport is wrapped, to inject the synchronization
      // point; no bootstrap logic is reimplemented in the test.
      connectFn: barrierConnectFn(barrier, LOCK_ACQUIRE_SQL),
      readManifestFn: manifestFor(ownerId, adminId),
      promptFn: async () => "BOOTSTRAP",
      ...silent,
    });

  const invocationsSettled = Promise.all([invoke(OWNER_A, ADMIN_1), invoke(OWNER_B, ADMIN_2)]);
  const deadlock = sleep(15_000).then(() => {
    throw new Error(
      "TIMEOUT: both invocations never reached pg_advisory_xact_lock together — either the lock " +
        "statement was never issued by one of them, or the barrier never released (deadlock).",
    );
  });
  const [rA, rB] = await Promise.race([invocationsSettled, deadlock]);

  const winners = [rA, rB].filter((r) => r.mutated === true);
  const losers = [rA, rB].filter((r) => r.mutated !== true);

  assert.equal(winners.length, 1, `expected exactly one winner, got: ${JSON.stringify([rA, rB])}`);
  assert.equal(losers.length, 1);
  assert.equal(losers[0].ok, false, "the loser must be refused/rolled back, not silently ok");
  assert.ok(losers[0].refused === true || losers[0].rolledBack === true, `loser must be refused or rolled back: ${JSON.stringify(losers[0])}`);

  // Phase 4 — assert final state directly from the disposable database,
  // not from the JS return values alone.
  const staff = await countStaff();
  const owners = staff.filter((r) => r.role === "OWNER");
  const admins = staff.filter((r) => r.role === "ADMIN");
  assert.equal(owners.length, 1, `workspace must end with exactly ONE OWNER row, got: ${JSON.stringify(staff)}`);
  assert.ok(owners[0].user_id === OWNER_A || owners[0].user_id === OWNER_B, "surviving OWNER must be one of the two authorized candidates");
  assert.equal(owners[0].status, "ACTIVE");
  // Exactly the WINNING manifest's own admin may survive — never a mix,
  // never the loser's admin (would indicate a partial/leaked manifest).
  assert.equal(admins.length, 1, `exactly one ADMIN (the winner's own) may survive, got: ${JSON.stringify(staff)}`);
  const winnerIsA = owners[0].user_id === OWNER_A;
  assert.equal(admins[0].user_id, winnerIsA ? ADMIN_1 : ADMIN_2, "surviving ADMIN must belong to the WINNING manifest, not the loser's");
  assert.equal(admins[0].status, "ACTIVE");
  assert.equal(staff.length, 2, "no partial/orphan rows from the losing transaction may survive (exactly 1 OWNER + 1 ADMIN)");

  // Cleanup so later tests in this file start from a clean workspace.
  await client.query("delete from staff_members where workspace_org_id = $1", [ORG]);
});

// Phase 7 — same manifest, genuinely concurrent: must converge, never duplicate.
test("concurrent bootstrap: SAME manifest fired twice — converges to exactly one committed set, no duplication", async () => {
  const manifest = () => ({
    ownerUserId: OWNER_A,
    adminUserIds: [ADMIN_1, ADMIN_2],
    expectedWorkspaceOrgId: ORG,
    expectedDbName: PG_DB,
  });
  const invoke = () =>
    runBootstrap({
      argv: ["--manifest", "x", "--db-url", URL, "--apply", "--confirm-owner-id", OWNER_A],
      env: TEST_ENV,
      readManifestFn: manifest,
      promptFn: async () => "BOOTSTRAP",
      ...silent,
    });

  const [r1, r2] = await Promise.all([invoke(), invoke()]);

  // Exactly one of the two must be the one that actually inserted; the
  // other must observe the identical committed set (under the lock) and
  // report "already bootstrapped" with zero further mutation. Both must
  // be `ok: true` — a same-manifest race is NOT an error condition.
  assert.equal(r1.ok, true, JSON.stringify(r1));
  assert.equal(r2.ok, true, JSON.stringify(r2));
  const mutatedCount = [r1, r2].filter((r) => r.mutated === true).length;
  const alreadyCount = [r1, r2].filter((r) => r.alreadyBootstrapped === true).length;
  assert.equal(mutatedCount, 1, `expected exactly one inserter: ${JSON.stringify([r1, r2])}`);
  assert.equal(alreadyCount, 1, `expected exactly one already-bootstrapped observer: ${JSON.stringify([r1, r2])}`);

  const staff = await countStaff();
  assert.equal(staff.length, 3, "exactly 1 OWNER + 2 ADMIN, no duplicates");
  assert.deepEqual(
    staff.map((r) => `${r.role}:${r.user_id}:${r.status}`).sort(),
    [`ADMIN:${ADMIN_1}:ACTIVE`, `ADMIN:${ADMIN_2}:ACTIVE`, `OWNER:${OWNER_A}:ACTIVE`].sort(),
  );

  await client.query("delete from staff_members where workspace_org_id = $1", [ORG]);
});

// ---------------------------------------------------------------
// Phase 8 — failure after lock acquisition: ROLLBACK + automatic lock release.
test("rollback after lock acquisition: transaction rolls back, lock releases, a later valid bootstrap proceeds", async () => {
  // A connectFn that opens a REAL client, then poisons exactly the first
  // "insert into staff_members" call so it throws — simulating a failure
  // that occurs strictly AFTER pg_advisory_xact_lock has already been
  // acquired inside the transaction (the lock statement and the
  // authoritative re-read both run, unmodified, before the insert).
  function poisonedConnectFn() {
    return async (connectionString) => {
      const real = new Client({ connectionString });
      await real.connect();
      let poisoned = false;
      return {
        query: async (sql, params) => {
          if (!poisoned && /insert\s+into\s+staff_members/i.test(sql)) {
            poisoned = true;
            throw new Error("INJECTED FAILURE (test): simulated write failure after lock acquisition");
          }
          return real.query(sql, params);
        },
        end: () => real.end(),
      };
    };
  }

  const manifest = () => ({
    ownerUserId: OWNER_A,
    adminUserIds: [],
    expectedWorkspaceOrgId: ORG,
    expectedDbName: PG_DB,
  });

  const failing = await runBootstrap({
    argv: ["--manifest", "x", "--db-url", URL, "--apply", "--confirm-owner-id", OWNER_A],
    env: TEST_ENV,
    connectFn: poisonedConnectFn(),
    readManifestFn: manifest,
    promptFn: async () => "BOOTSTRAP",
    ...silent,
  });
  assert.equal(failing.ok, false);
  assert.equal(failing.mutated, false);
  assert.equal(failing.rolledBack, true, JSON.stringify(failing));
  assert.match(failing.reason ?? "", /INJECTED FAILURE/);

  const afterFailure = await countStaff();
  assert.equal(afterFailure.length, 0, "no partial staff_members rows after rollback");

  // If the advisory lock had NOT been released by the ROLLBACK, this next
  // call would hang waiting on pg_advisory_xact_lock. Bound it with a
  // short timeout via statement handling: we simply race it against a
  // deadline — success proves the lock is free.
  const raceResult = await Promise.race([
    runBootstrap({
      argv: ["--manifest", "x", "--db-url", URL, "--apply", "--confirm-owner-id", OWNER_A],
      env: TEST_ENV,
      readManifestFn: manifest,
      promptFn: async () => "BOOTSTRAP",
      ...silent,
    }),
    sleep(10_000).then(() => ({ __timedOut: true })),
  ]);
  assert.notEqual(raceResult.__timedOut, true, "bootstrap hung — advisory lock was not released after ROLLBACK");
  assert.equal(raceResult.ok, true, JSON.stringify(raceResult));
  assert.equal(raceResult.mutated, true);

  const staff = await countStaff();
  assert.equal(staff.length, 1);
  assert.equal(staff[0].user_id, OWNER_A);
  assert.equal(staff[0].role, "OWNER");

  await client.query("delete from staff_members where workspace_org_id = $1", [ORG]);
});

// ---------------------------------------------------------------
// Phase 9 — lock-key scoping across workspaces.
//
// The bootstrap tool always resolves its single "internal workspace" via
// `select id from organizations where is_internal = true`, and that
// column is guarded by a real DB-level partial unique index
// (organizations_is_internal_unique) enforcing at most one such row can
// ever exist. Creating a second "internal-like" org to run the FULL
// bootstrap tool end-to-end against two workspaces would therefore either
// violate that constraint, or (if using is_internal=false) simply cause
// the tool's own "expected exactly one internal workspace" guard to
// refuse — neither exercises the lock-scoping question meaningfully at
// the tool level. Instead, this test verifies the underlying locking
// PRIMITIVE the tool relies on is correctly scoped by workspace id, at
// the mechanism level, independent of business rules:
test("advisory lock key is workspace-scoped: two different workspace ids never block each other", async () => {
  const wsX = randomUUID();
  const wsY = randomUUID();

  const cX = new Client({ connectionString: URL });
  const cY = new Client({ connectionString: URL });
  await cX.connect();
  await cY.connect();
  try {
    await cX.query("BEGIN");
    await cY.query("BEGIN");

    // X holds its lock for workspace wsX...
    await cX.query("select pg_advisory_xact_lock(hashtext('rbac-staff-bootstrap'), hashtext($1::text))", [wsX]);

    // ...Y must be able to immediately acquire the SAME lock statement
    // for a DIFFERENT workspace id, with no blocking (bounded by a short
    // timeout — if this hangs, the keys are not workspace-scoped).
    const yAcquired = await Promise.race([
      cY.query("select pg_advisory_xact_lock(hashtext('rbac-staff-bootstrap'), hashtext($1::text))", [wsY]).then(() => true),
      sleep(3000).then(() => false),
    ]);
    assert.equal(yAcquired, true, "a different workspace id must not be blocked by another workspace's lock");

    await cX.query("COMMIT");
    await cY.query("COMMIT");
  } finally {
    await cX.end().catch(() => {});
    await cY.end().catch(() => {});
  }
});

test("advisory lock key is workspace-scoped: the SAME workspace id DOES serialize", async () => {
  const ws = randomUUID();
  const cX = new Client({ connectionString: URL });
  const cY = new Client({ connectionString: URL });
  await cX.connect();
  await cY.connect();
  try {
    await cX.query("BEGIN");
    await cY.query("BEGIN");

    await cX.query("select pg_advisory_xact_lock(hashtext('rbac-staff-bootstrap'), hashtext($1::text))", [ws]);

    // Y attempting the SAME workspace id must block (not immediately
    // resolve) while X still holds the lock.
    let yResolved = false;
    const yPromise = cY
      .query("select pg_advisory_xact_lock(hashtext('rbac-staff-bootstrap'), hashtext($1::text))", [ws])
      .then(() => { yResolved = true; });

    await sleep(500);
    assert.equal(yResolved, false, "same workspace id must block while the first transaction holds the lock");

    await cX.query("COMMIT"); // releases X's lock
    await yPromise; // now Y can proceed
    assert.equal(yResolved, true);
    await cY.query("COMMIT");
  } finally {
    await cX.end().catch(() => {});
    await cY.end().catch(() => {});
  }
});
