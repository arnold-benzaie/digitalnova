// RADAR INTELLIGENCE V2.1 — Phase G4B-1 — quota-counter-store.ts unit tests.
//
// @/db is mocked to a fake in-memory stand-in (same convention as
// quota-policy-store.test.mjs / provider-policy-store.test.mjs) so this
// suite needs neither a live Postgres connection nor DATABASE_URL set.
// Real-Postgres CONCURRENCY proof lives in
// quota-counter-store.integration.test.mjs (this file cannot prove
// atomicity against a fake in-memory object -- only against real
// Postgres row locking).
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/quota-counter-store.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

/** @type {Map<string, { key: string; requestCount: number; tokenCount: number; windowStart: Date; updatedAt: Date }>} */
let rows = new Map();
/** @type {Array<{ values: any; set: any }>} */
let upsertCalls = [];
/** @type {{ error?: unknown }} */
let selectErrorState = {};
/** @type {{ error?: unknown }} */
let upsertErrorState = {};
/**
 * Forces the NEXT upsert to behave exactly like a real Postgres
 * `ON CONFLICT DO UPDATE ... WHERE <guard>` whose guard evaluated to
 * false: zero rows returned, the stored row left COMPLETELY unchanged.
 * The real guard's actual evaluation (proven under real concurrency) is
 * quota-counter-store.concurrency.integration.test.mjs's job -- this
 * fake only lets this file's tests verify tryAdmitGlobalRequest's OWN
 * plumbing: "zero rows returned" -> "return false", never mutate.
 * @type {boolean}
 */
let forceNextUpsertDenied = false;

const fakeDb = {
  insert: () => ({
    values: (values) => ({
      onConflictDoUpdate: ({ set, setWhere }) => ({
        returning: () => {
          upsertCalls.push({ values, set, setWhere });
          if (upsertErrorState.error) return Promise.reject(upsertErrorState.error);
          if (forceNextUpsertDenied) {
            forceNextUpsertDenied = false;
            return Promise.resolve([]);
          }
          const existing = rows.get(values.key);
          let row;
          if (!existing) {
            row = { key: values.key, requestCount: values.requestCount, tokenCount: values.tokenCount, windowStart: values.windowStart, updatedAt: values.updatedAt };
          } else {
            // Mirrors the real SQL: requestCount/tokenCount are additive
            // deltas expressed relative to the INSERT branch's own
            // values (1 request unit, or a token delta), never an
            // absolute overwrite -- matches `col = col + delta`.
            row = {
              key: existing.key,
              requestCount: existing.requestCount + (values.requestCount ?? 0),
              tokenCount: existing.tokenCount + (values.tokenCount ?? 0),
              windowStart: existing.windowStart,
              updatedAt: set.updatedAt,
            };
          }
          rows.set(values.key, row);
          return Promise.resolve([{ key: row.key, requestCount: row.requestCount, tokenCount: row.tokenCount, windowStart: row.windowStart }]);
        },
      }),
    }),
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          if (selectErrorState.error) return Promise.reject(selectErrorState.error);
          // The fake has no query-object introspection; tests that need
          // a specific key read pre-seed `rows` with exactly one entry
          // and read it back via readGlobalQuotaCounter(now) for the
          // SAME now, so there is never ambiguity about which row this
          // resolves to in practice for this suite's assertions.
          const [row] = [...rows.values()];
          return Promise.resolve(row ? [row] : []);
        },
      }),
    }),
  }),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const { currentGlobalQuotaKey, incrementGlobalRequestCount, incrementGlobalTokenCount, readGlobalQuotaCounter, tryAdmitGlobalRequest, admitGlobalRequestUnit } = await import(
  "./quota-counter-store.ts"
);

function reset() {
  rows = new Map();
  upsertCalls = [];
  selectErrorState = {};
  upsertErrorState = {};
  forceNextUpsertDenied = false;
}

test.beforeEach(reset);

const DAY_1 = new Date("2026-09-13T10:00:00.000Z");
const DAY_1_LATER = new Date("2026-09-13T23:59:59.999Z");
const DAY_2 = new Date("2026-09-14T00:00:00.001Z");

// ---- key construction ----

test("currentGlobalQuotaKey: deterministic 'global:<UTC-date>' shape", () => {
  assert.equal(currentGlobalQuotaKey(DAY_1), "global:2026-09-13");
});

test("currentGlobalQuotaKey: two timestamps on the same UTC day produce the SAME key", () => {
  assert.equal(currentGlobalQuotaKey(DAY_1), currentGlobalQuotaKey(DAY_1_LATER));
});

test("currentGlobalQuotaKey: crossing midnight UTC produces a DIFFERENT key", () => {
  assert.notEqual(currentGlobalQuotaKey(DAY_1_LATER), currentGlobalQuotaKey(DAY_2));
});

test("currentGlobalQuotaKey: is stable regardless of the host's local timezone interpretation -- always UTC", () => {
  // A timestamp deliberately close to a local-timezone midnight boundary
  // that is NOT a UTC midnight boundary -- the key must still reflect
  // the UTC calendar day, never a local one.
  const nearLocalMidnight = new Date("2026-09-13T23:30:00.000Z");
  assert.equal(currentGlobalQuotaKey(nearLocalMidnight), "global:2026-09-13");
});

// ---- incrementGlobalRequestCount ----

test("incrementGlobalRequestCount: first call of a new period creates the row with requestCount=1, tokenCount=0", async () => {
  const snapshot = await incrementGlobalRequestCount(DAY_1);
  assert.equal(snapshot.key, "global:2026-09-13");
  assert.equal(snapshot.requestCount, 1);
  assert.equal(snapshot.tokenCount, 0);
});

test("incrementGlobalRequestCount: a second call in the SAME period increments the SAME row, never creating a duplicate", async () => {
  await incrementGlobalRequestCount(DAY_1);
  const second = await incrementGlobalRequestCount(DAY_1_LATER);
  assert.equal(second.requestCount, 2);
  assert.equal(rows.size, 1, "exactly one row must exist for the period, never two");
});

test("incrementGlobalRequestCount: a new UTC day creates a genuinely NEW, independent row", async () => {
  await incrementGlobalRequestCount(DAY_1);
  await incrementGlobalRequestCount(DAY_1);
  const day2 = await incrementGlobalRequestCount(DAY_2);
  assert.equal(day2.requestCount, 1, "the new day's counter starts fresh, unrelated to the prior day's accumulated count");
  assert.equal(rows.size, 2);
});

test("incrementGlobalRequestCount: never touches tokenCount", async () => {
  await incrementGlobalTokenCount(500, DAY_1);
  const snapshot = await incrementGlobalRequestCount(DAY_1);
  assert.equal(snapshot.tokenCount, 500, "requestCount increment must never reset or alter the token counter");
});

test("incrementGlobalRequestCount: uses a single atomic INSERT...ON CONFLICT DO UPDATE...RETURNING call, never a separate SELECT first", async () => {
  await incrementGlobalRequestCount(DAY_1);
  assert.equal(upsertCalls.length, 1);
});

test("incrementGlobalRequestCount: windowStart is the UTC calendar-day start, not the exact call time", async () => {
  const snapshot = await incrementGlobalRequestCount(DAY_1);
  assert.equal(snapshot.windowStart.toISOString(), "2026-09-13T00:00:00.000Z");
});

test("incrementGlobalRequestCount: a DB failure propagates (rejects), never silently swallowed or defaulted", async () => {
  upsertErrorState = { error: new Error("connection refused") };
  await assert.rejects(() => incrementGlobalRequestCount(DAY_1), /connection refused/);
});

// ---- incrementGlobalTokenCount ----

test("incrementGlobalTokenCount: first call of a new period creates the row with the given delta, requestCount=0", async () => {
  const snapshot = await incrementGlobalTokenCount(1200, DAY_1);
  assert.equal(snapshot.tokenCount, 1200);
  assert.equal(snapshot.requestCount, 0);
});

test("incrementGlobalTokenCount: subsequent calls ADD to the existing token count", async () => {
  await incrementGlobalTokenCount(1000, DAY_1);
  const second = await incrementGlobalTokenCount(500, DAY_1);
  assert.equal(second.tokenCount, 1500);
});

test("incrementGlobalTokenCount: delta=0 is valid and leaves the stored value unchanged", async () => {
  await incrementGlobalTokenCount(1000, DAY_1);
  const second = await incrementGlobalTokenCount(0, DAY_1);
  assert.equal(second.tokenCount, 1000);
});

test("incrementGlobalTokenCount: a negative delta is rejected BEFORE any DB access", async () => {
  await assert.rejects(() => incrementGlobalTokenCount(-1, DAY_1), /non-negative integer/);
  assert.equal(upsertCalls.length, 0, "no DB call must happen for a rejected delta");
});

test("incrementGlobalTokenCount: a non-integer delta is rejected", async () => {
  for (const bad of [1.5, NaN, Infinity, "100"]) {
    await assert.rejects(() => incrementGlobalTokenCount(bad, DAY_1), /non-negative integer/);
  }
  assert.equal(upsertCalls.length, 0);
});

test("incrementGlobalTokenCount: never touches requestCount", async () => {
  await incrementGlobalRequestCount(DAY_1);
  await incrementGlobalRequestCount(DAY_1);
  const snapshot = await incrementGlobalTokenCount(300, DAY_1);
  assert.equal(snapshot.requestCount, 2, "token increment must never reset or alter the request counter");
});

test("incrementGlobalTokenCount: a DB failure propagates, never silently swallowed", async () => {
  upsertErrorState = { error: new Error("connection refused") };
  await assert.rejects(() => incrementGlobalTokenCount(100, DAY_1), /connection refused/);
});

// ---- readGlobalQuotaCounter ----

test("readGlobalQuotaCounter: no row yet for the period -> null, never a fabricated zero snapshot", async () => {
  const snapshot = await readGlobalQuotaCounter(DAY_1);
  assert.equal(snapshot, null);
});

test("readGlobalQuotaCounter: reflects the real accumulated state after increments", async () => {
  await incrementGlobalRequestCount(DAY_1);
  await incrementGlobalRequestCount(DAY_1);
  await incrementGlobalTokenCount(4200, DAY_1);
  const snapshot = await readGlobalQuotaCounter(DAY_1);
  assert.equal(snapshot.requestCount, 2);
  assert.equal(snapshot.tokenCount, 4200);
});

test("readGlobalQuotaCounter: never mutates anything (read-only)", async () => {
  await incrementGlobalRequestCount(DAY_1);
  await readGlobalQuotaCounter(DAY_1);
  await readGlobalQuotaCounter(DAY_1);
  const snapshot = await readGlobalQuotaCounter(DAY_1);
  assert.equal(snapshot.requestCount, 1, "repeated reads must never increment anything");
});

test("readGlobalQuotaCounter: a DB failure propagates, never silently returns null", async () => {
  selectErrorState = { error: new Error("connection refused") };
  await assert.rejects(() => readGlobalQuotaCounter(DAY_1), /connection refused/);
});

// ---- no provider/user/secret dependency (structural safety net) ----

test("this module never references a providerId, userId, or secret-shaped field anywhere in its own source", async () => {
  const { readFileSync } = await import("node:fs");
  const source = readFileSync(new URL("./quota-counter-store.ts", import.meta.url), "utf8").replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
  assert.equal(/providerId|userId|apiKey|secret|credential/i.test(source), false);
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase G4B-2 — tryAdmitGlobalRequest() /
// admitGlobalRequestUnit(). The fake DB above proves this file's OWN
// plumbing (input validation, DB-response interpretation, which
// underlying primitive gets called for which limit shape) -- the real
// atomic CAS guard's actual behavior under concurrency is proven for
// real in quota-counter-store.concurrency.integration.test.mjs.
// =====================================================================

// ---- tryAdmitGlobalRequest: input validation ----

test("tryAdmitGlobalRequest: limit=0 throws BEFORE any DB access", async () => {
  await assert.rejects(() => tryAdmitGlobalRequest(0, DAY_1), /positive integer/);
  assert.equal(upsertCalls.length, 0);
});

test("tryAdmitGlobalRequest: a negative limit throws BEFORE any DB access", async () => {
  await assert.rejects(() => tryAdmitGlobalRequest(-1, DAY_1), /positive integer/);
  assert.equal(upsertCalls.length, 0);
});

test("tryAdmitGlobalRequest: a non-integer limit throws", async () => {
  for (const bad of [1.5, NaN, Infinity, "10"]) {
    await assert.rejects(() => tryAdmitGlobalRequest(bad, DAY_1), /positive integer/);
  }
  assert.equal(upsertCalls.length, 0);
});

// ---- tryAdmitGlobalRequest: DB-response interpretation ----

test("tryAdmitGlobalRequest: a returned row -> true (admitted), and the atomic statement carries a setWhere guard", async () => {
  const admitted = await tryAdmitGlobalRequest(10, DAY_1);
  assert.equal(admitted, true);
  assert.equal(upsertCalls.length, 1);
  assert.ok(upsertCalls[0].setWhere, "the conditional CAS guard must be present on every call -- never an unconditional increment for a positive limit");
});

test("tryAdmitGlobalRequest: zero rows returned (the real guard denied) -> false, and the fake's row is provably unchanged", async () => {
  await incrementGlobalRequestCount(DAY_1); // seed an existing row: requestCount=1
  forceNextUpsertDenied = true;
  const admitted = await tryAdmitGlobalRequest(10, DAY_1);
  assert.equal(admitted, false);
  const snapshot = await readGlobalQuotaCounter(DAY_1);
  assert.equal(snapshot.requestCount, 1, "a denied admission must leave the counter COMPLETELY unchanged -- no consolation increment");
});

test("tryAdmitGlobalRequest: a DB failure propagates, never silently returns false", async () => {
  upsertErrorState = { error: new Error("connection refused") };
  await assert.rejects(() => tryAdmitGlobalRequest(10, DAY_1), /connection refused/);
});

// ---- admitGlobalRequestUnit: null/0/positive branching ----

test("admitGlobalRequestUnit: dailyRequestLimit=null -> always true, delegates to the plain unconditional increment (no setWhere guard)", async () => {
  const admitted = await admitGlobalRequestUnit(null, DAY_1);
  assert.equal(admitted, true);
  assert.equal(upsertCalls.length, 1);
  assert.equal(upsertCalls[0].setWhere, undefined, "the null (no-limit) path must reuse incrementGlobalRequestCount()'s own unconditional statement, never a guarded one");
  const snapshot = await readGlobalQuotaCounter(DAY_1);
  assert.equal(snapshot.requestCount, 1);
});

test("admitGlobalRequestUnit: dailyRequestLimit=0 -> always false, ZERO DB calls, for any pre-existing state", async () => {
  await incrementGlobalTokenCount(500, DAY_1); // some unrelated pre-existing activity for the period
  upsertCalls = []; // ignore the seed call above
  const admitted = await admitGlobalRequestUnit(0, DAY_1);
  assert.equal(admitted, false);
  assert.equal(upsertCalls.length, 0, "limit=0 must be resolved as a static fact about the policy -- it never touches the counter at all");
  const snapshot = await readGlobalQuotaCounter(DAY_1);
  assert.equal(snapshot.requestCount, 0, "the counter's requestCount must remain exactly 0 -- never incremented for a limit=0 policy");
});

test("admitGlobalRequestUnit: dailyRequestLimit=N (positive) -> delegates to tryAdmitGlobalRequest with a setWhere guard", async () => {
  const admitted = await admitGlobalRequestUnit(5, DAY_1);
  assert.equal(admitted, true);
  assert.equal(upsertCalls.length, 1);
  assert.ok(upsertCalls[0].setWhere);
});

test("admitGlobalRequestUnit: dailyRequestLimit=N, denied by the real guard -> false, counter unchanged", async () => {
  await incrementGlobalRequestCount(DAY_1);
  forceNextUpsertDenied = true;
  const admitted = await admitGlobalRequestUnit(1, DAY_1);
  assert.equal(admitted, false);
  const snapshot = await readGlobalQuotaCounter(DAY_1);
  assert.equal(snapshot.requestCount, 1);
});

test("admitGlobalRequestUnit: a DB failure (positive-limit path) propagates, never silently returns false", async () => {
  upsertErrorState = { error: new Error("connection refused") };
  await assert.rejects(() => admitGlobalRequestUnit(10, DAY_1), /connection refused/);
});
