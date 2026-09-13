// RADAR INTELLIGENCE V2.1 — Phase G4B-1 — real-Postgres concurrency proof
// for quota-counter-store.ts's atomic INSERT...ON CONFLICT DO
// UPDATE...RETURNING primitives.
//
// The unit suite (quota-counter-store.test.mjs) mocks @/db and CANNOT
// prove atomicity -- a fake in-memory object has no row locking to test.
// This file spins its OWN disposable postgres:16-alpine container
// (random name/port, --rm, destroyed in `after`) -- the exact pattern
// scripts/bootstrap-first-staff-owner.concurrency.integration.test.mjs
// and scripts/migration-replay-check.mjs already use -- applies the
// REAL, reviewed migration set via scripts/db-migrate.mjs's own run(),
// then drives real, concurrent Promise.all() calls through the REAL
// store implementation against the REAL table. NEVER touches
// Preview/Production or any remote host, and NEVER mutates the shared
// local `public-map-approval-test-db` container other suites depend on.
//
// Requires Docker. Run:
//   npx tsx --test lib/radar-intelligence/quota-counter-store.concurrency.integration.test.mjs
import { test, before, after, mock } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomUUID } from "node:crypto";
import { setTimeout as sleep } from "node:timers/promises";
import { Pool } from "pg";

import { run as runMigrate } from "../../scripts/db-migrate.mjs";

const CONTAINER = `pm-quota-counter-concurrency-${randomUUID().slice(0, 8)}`;
const HOST_PORT = 5760 + Math.floor(Math.random() * 60); // 5760-5819 -- clear of every other suite's disposable-container range
const PG_USER = "quota_counter_concurrency";
const PG_PASSWORD = "quota_counter_concurrency_local_only";
const PG_DB = "quota_counter_concurrency_check";
const URL = `postgresql://${PG_USER}:${PG_PASSWORD}@127.0.0.1:${HOST_PORT}/${PG_DB}`;

if (/supabase|neon|pooler/i.test(URL) || !/@127\.0\.0\.1:/.test(URL)) {
  throw new Error("REFUS : cible non locale. Arret avant tout demarrage de conteneur.");
}

const sh = (cmd, args, opts = {}) => spawnSync(cmd, args, { encoding: "utf8", ...opts });
const TEST_ENV = { RBAC_MIG_TEST_MODE: "1" };
const silent = { log: () => {}, error: () => {} };

let pool;
let containerStarted = false;
let incrementGlobalRequestCount;
let incrementGlobalTokenCount;
let readGlobalQuotaCounter;
let tryAdmitGlobalRequest;
let admitGlobalRequestUnit;
let dbForTeardown;

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
    try {
      await pool.query("select 1");
      ready = true;
    } catch {
      await sleep(500);
    }
  }
  if (!ready) throw new Error("Postgres jetable jamais pret.");

  // Apply the REAL, reviewed migration set (0000..0043) — radar_ai_quota_counter
  // has zero FKs and zero dependency on any other table's data, but this
  // reuses the exact same reviewed tooling every other disposable-container
  // check in this repo already trusts, rather than hand-extracting DDL.
  const rMig = await runMigrate({ argv: ["--apply", "--db-url", URL], env: TEST_ENV, promptFn: async () => "MIGRATE", ...silent });
  assert.equal(rMig.ok, true, `migrate failed: ${JSON.stringify(rMig)}`);

  // DATABASE_URL must point at THIS disposable container before @/db is
  // ever imported — db/index.ts reads it once, at module load.
  process.env.DATABASE_URL = URL;
  // "server-only" throws outside Next.js's own server-component build
  // pipeline (which this plain node:test run is not) — mocked exactly
  // like every other integration test in this repo that imports a
  // server-only module directly.
  mock.module("server-only", { namedExports: {} });
  ({ incrementGlobalRequestCount, incrementGlobalTokenCount, readGlobalQuotaCounter, tryAdmitGlobalRequest, admitGlobalRequestUnit } = await import("./quota-counter-store.ts"));
  ({ db: dbForTeardown } = await import("@/db"));
});

after(async () => {
  await pool?.end().catch(() => {});
  // The store's own drizzle client holds a SEPARATE pg.Pool (created at
  // @/db module load, once DATABASE_URL pointed here) — it must be
  // closed before the container is force-removed, or the abrupt kill
  // surfaces as an "unexpected postmaster exit" async error on whatever
  // test happens to be running at that moment.
  await dbForTeardown?.$client.end().catch(() => {});
  if (containerStarted) sh("docker", ["rm", "-f", CONTAINER], { stdio: "ignore" });
});

// Each test below uses a GENUINELY DISTINCT UTC calendar day (the key's
// only granularity, per currentGlobalQuotaKey()) so tests never share a
// counter row and can assert exact, isolated final values.
const FIXED_NOW = new Date("2026-09-13T12:00:00.000Z");

test("2 concurrent requestCount increments on the same period produce EXACTLY 2, never 1 (no lost update)", async () => {
  const [a, b] = await Promise.all([incrementGlobalRequestCount(FIXED_NOW), incrementGlobalRequestCount(FIXED_NOW)]);
  const values = [a.requestCount, b.requestCount].sort();
  assert.deepEqual(values, [1, 2], "the two concurrent callers must receive distinct, sequential post-increment values");
  const final = await readGlobalQuotaCounter(FIXED_NOW);
  assert.equal(final.requestCount, 2);
});

test("10 concurrent requestCount increments on the same fresh period produce EXACTLY 10, with 10 distinct returned values", async () => {
  const now = new Date("2026-09-14T13:00:00.000Z"); // a distinct UTC day from the prior test
  const results = await Promise.all(Array.from({ length: 10 }, () => incrementGlobalRequestCount(now)));
  const values = results.map((r) => r.requestCount).sort((x, y) => x - y);
  assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8, 9, 10], "every concurrent caller must receive a UNIQUE post-increment value -- any duplicate or gap would prove a lost update");
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.requestCount, 10);
});

test("50 concurrent requestCount increments never lose an update, never duplicate a row, never go negative", async () => {
  const now = new Date("2026-09-15T14:00:00.000Z");
  const results = await Promise.all(Array.from({ length: 50 }, () => incrementGlobalRequestCount(now)));
  const values = results.map((r) => r.requestCount);
  assert.equal(new Set(values).size, 50, "every returned value must be unique -- a duplicate proves two callers received the same post-increment count (a lost update)");
  assert.ok(values.every((v) => v >= 1), "no value may ever be negative or zero");
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.requestCount, 50);
});

test("concurrent FIRST-of-period increments (no row exists yet) still converge to exactly N, never creating duplicate rows", async () => {
  const now = new Date("2026-09-16T15:00:00.000Z"); // guaranteed no pre-existing row
  const before = await readGlobalQuotaCounter(now);
  assert.equal(before, null, "sanity: no row exists yet for this period");
  const results = await Promise.all(Array.from({ length: 8 }, () => incrementGlobalRequestCount(now)));
  const values = results.map((r) => r.requestCount).sort((x, y) => x - y);
  assert.deepEqual(values, [1, 2, 3, 4, 5, 6, 7, 8]);
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.requestCount, 8, "exactly one row for the period, correctly counted -- no duplicate-row race on the very first concurrent access");
});

test("concurrent tokenCount increments sum exactly, with no lost update", async () => {
  const now = new Date("2026-09-17T16:00:00.000Z");
  const deltas = [100, 250, 75, 900, 1000, 40, 60, 5];
  await Promise.all(deltas.map((d) => incrementGlobalTokenCount(d, now)));
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.tokenCount, deltas.reduce((sum, d) => sum + d, 0), "the sum of all concurrent token deltas must be exact -- any loss would under-count real consumption");
});

test("concurrent requestCount AND tokenCount increments on the same row do not corrupt each other", async () => {
  const now = new Date("2026-09-18T17:00:00.000Z");
  const requestCalls = Array.from({ length: 5 }, () => incrementGlobalRequestCount(now));
  const tokenCalls = [111, 222, 333].map((d) => incrementGlobalTokenCount(d, now));
  await Promise.all([...requestCalls, ...tokenCalls]);
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.requestCount, 5);
  assert.equal(final.tokenCount, 111 + 222 + 333);
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase G4B-2 — tryAdmitGlobalRequest() /
// admitGlobalRequestUnit() under real concurrency. This is the mission-
// critical proof: "limit=10, current=9, 10 concurrent requests -> exactly
// ONE more admission, the other nine denied, with ZERO artificial
// increment on any denied request."
// =====================================================================

test("CRITICAL: limit=10, current=9 -> 10 concurrent admission attempts admit EXACTLY 1, deny the other 9, final count is exactly 10 (never 19)", async () => {
  const now = new Date("2026-09-19T09:00:00.000Z");
  for (let i = 0; i < 9; i++) await tryAdmitGlobalRequest(10, now); // pre-seed current=9
  const preSeeded = await readGlobalQuotaCounter(now);
  assert.equal(preSeeded.requestCount, 9, "sanity: exactly 9 before the race");

  const results = await Promise.all(Array.from({ length: 10 }, () => tryAdmitGlobalRequest(10, now)));
  const admittedCount = results.filter((r) => r === true).length;
  const deniedCount = results.filter((r) => r === false).length;
  assert.equal(admittedCount, 1, "with 9 already consumed against a limit of 10, exactly ONE of the 10 racing callers may be admitted");
  assert.equal(deniedCount, 9, "the other nine MUST be denied -- not merely 'eventually consistent', but denied for THIS specific call");

  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.requestCount, 10, "the counter must land on EXACTLY 10 -- a denied call must never add a phantom unit (this would be 19 if every racer incremented unconditionally)");
});

test("CRITICAL: limit=1, 2 concurrent admission attempts on a BRAND NEW period -> exactly 1 admitted, 1 denied, final count is exactly 1", async () => {
  const now = new Date("2026-09-20T09:00:00.000Z");
  const before = await readGlobalQuotaCounter(now);
  assert.equal(before, null, "sanity: no row exists yet");

  const [a, b] = await Promise.all([tryAdmitGlobalRequest(1, now), tryAdmitGlobalRequest(1, now)]);
  const admitted = [a, b].filter((r) => r === true).length;
  assert.equal(admitted, 1, "exactly one of the two simultaneous first-ever callers for a limit=1 period may be admitted");
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.requestCount, 1);
});

test("CRITICAL: limit=0 (via admitGlobalRequestUnit) -> 10 concurrent calls all denied, ZERO DB writes, counter never created", async () => {
  const now = new Date("2026-09-21T09:00:00.000Z");
  const results = await Promise.all(Array.from({ length: 10 }, () => admitGlobalRequestUnit(0, now)));
  assert.ok(results.every((r) => r === false), "every single one of the 10 concurrent callers must be denied when the policy limit is 0");
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final, null, "no counter row must ever be created for a limit=0 period, however many callers raced for it");
});

test("CRITICAL: 50 concurrent admission attempts against limit=20 on a fresh period admit EXACTLY 20, never more, never fewer", async () => {
  const now = new Date("2026-09-22T09:00:00.000Z");
  const results = await Promise.all(Array.from({ length: 50 }, () => tryAdmitGlobalRequest(20, now)));
  const admittedCount = results.filter((r) => r === true).length;
  assert.equal(admittedCount, 20, "exactly the configured limit must be admitted out of 50 simultaneous callers, regardless of arrival order");
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.requestCount, 20, "the stored counter must land exactly on the limit -- never overshoot from a denied call, never undershoot from a lost admission");
});

test("multiple concurrent callers (simulating different users) all race against the SAME global counter -- there is no per-caller isolation", async () => {
  const now = new Date("2026-09-23T09:00:00.000Z");
  // Nothing here is scoped by user in any way -- calling the same
  // function concurrently from what would be N different staff members'
  // requests in production is indistinguishable, by design (G4B's scope
  // is GLOBAL, never per-user -- see quota-counter-store.ts's own
  // docstring). This test's only point: N concurrent callers share
  // exactly ONE counter row, never N independent ones.
  await Promise.all(Array.from({ length: 6 }, () => admitGlobalRequestUnit(100, now)));
  const final = await readGlobalQuotaCounter(now);
  assert.equal(final.requestCount, 6, "all 6 concurrent callers landed on the same single global row");
});
