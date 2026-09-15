// RADAR DISCOVERY ENGINE — Phase B — discovery-result-store.ts unit tests.
//
// @/db is mocked to a fake in-memory stand-in (same convention as
// lib/radar-intelligence/quota-counter-store.test.mjs) so this suite
// needs neither a live Postgres connection nor DATABASE_URL set. The
// real UNIQUE(source, source_id) constraint / CHECK constraints / FK are
// proven against a REAL Postgres by
// discovery-result-store.integration.test.mjs — this file only proves
// this module's OWN input validation/normalization and its
// insert-or-return-existing wiring.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-discovery/discovery-result-store.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

/** @type {Array<Record<string, unknown>>} */
let insertedValues = [];
/** @type {any[]} rows returned by the NEXT insert().onConflictDoNothing().returning() call */
let nextInsertReturns = [];
/** @type {any[]} rows returned by the NEXT select().from().where().limit() call */
let nextSelectReturns = [];
/** @type {Array<{ kind: string }>} */
let dbCalls = [];

const fakeDb = {
  insert: () => ({
    values: (values) => {
      insertedValues.push(values);
      return {
        onConflictDoNothing: () => ({
          returning: () => {
            dbCalls.push({ kind: "insert" });
            return Promise.resolve(nextInsertReturns);
          },
        }),
      };
    },
  }),
  select: () => ({
    from: () => ({
      where: () => ({
        limit: () => {
          dbCalls.push({ kind: "select" });
          return Promise.resolve(nextSelectReturns);
        },
      }),
    }),
  }),
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const { createDiscoveryResult, findDiscoveryResultBySource, DISCOVERY_RESULT_STATUSES } = await import("./discovery-result-store.ts");

function reset() {
  insertedValues = [];
  nextInsertReturns = [];
  nextSelectReturns = [];
  dbCalls = [];
}
test.beforeEach(reset);

function validInput(overrides = {}) {
  return { source: "google_places", sourceId: "abc123", name: "Test Business", ...overrides };
}

test("DISCOVERY_RESULT_STATUSES is exactly the four mission-required states", () => {
  assert.deepEqual([...DISCOVERY_RESULT_STATUSES], ["discovered", "enriched", "converted", "ignored"]);
});

test("createDiscoveryResult: a valid input inserts with trimmed values, status forced to 'discovered', no crmClientId field at all", async () => {
  nextInsertReturns = [{ id: "row-1", source: "google_places", sourceId: "abc123", name: "Test Business", status: "discovered", crmClientId: null }];
  const { result, created } = await createDiscoveryResult(validInput({ name: "  Test Business  " }));
  assert.equal(created, true);
  assert.equal(result.id, "row-1");
  assert.equal(insertedValues[0].name, "Test Business", "must be trimmed");
  assert.ok(!("status" in insertedValues[0]), "the insert payload must never set status directly -- the DB column default ('discovered') is the sole source of truth");
  assert.ok(!("crmClientId" in insertedValues[0]), "the insert payload must never set crmClientId -- structurally always absent");
});

test("createDiscoveryResult: missing/empty source throws BEFORE any database call", async () => {
  await assert.rejects(() => createDiscoveryResult(validInput({ source: "" })));
  assert.equal(dbCalls.length, 0);
  await assert.rejects(() => createDiscoveryResult(validInput({ source: "   " })));
  assert.equal(dbCalls.length, 0);
});

test("createDiscoveryResult: missing/empty sourceId throws before any database call", async () => {
  await assert.rejects(() => createDiscoveryResult(validInput({ sourceId: "" })));
  assert.equal(dbCalls.length, 0);
});

test("createDiscoveryResult: missing/empty name throws before any database call", async () => {
  await assert.rejects(() => createDiscoveryResult(validInput({ name: "" })));
  assert.equal(dbCalls.length, 0);
});

test("createDiscoveryResult: optional string fields normalize empty/whitespace-only to null", async () => {
  nextInsertReturns = [{ id: "row-1" }];
  await createDiscoveryResult(validInput({ category: "", address: "   ", website: undefined }));
  assert.equal(insertedValues[0].category, null);
  assert.equal(insertedValues[0].address, null);
  assert.equal(insertedValues[0].website, null);
});

test("createDiscoveryResult: latitude/longitude within range pass through unchanged", async () => {
  nextInsertReturns = [{ id: "row-1" }];
  await createDiscoveryResult(validInput({ latitude: 45.5017, longitude: -73.5673 }));
  assert.equal(insertedValues[0].latitude, 45.5017);
  assert.equal(insertedValues[0].longitude, -73.5673);
});

test("createDiscoveryResult: latitude out of [-90, 90] throws before any database call", async () => {
  await assert.rejects(() => createDiscoveryResult(validInput({ latitude: 91 })));
  assert.equal(dbCalls.length, 0);
  await assert.rejects(() => createDiscoveryResult(validInput({ latitude: -91 })));
});

test("createDiscoveryResult: longitude out of [-180, 180] throws before any database call", async () => {
  await assert.rejects(() => createDiscoveryResult(validInput({ longitude: 181 })));
  assert.equal(dbCalls.length, 0);
});

test("createDiscoveryResult: non-finite coordinates (NaN/Infinity) throw, never inserted", async () => {
  await assert.rejects(() => createDiscoveryResult(validInput({ latitude: NaN })));
  await assert.rejects(() => createDiscoveryResult(validInput({ latitude: Infinity })));
  assert.equal(dbCalls.length, 0);
});

test("createDiscoveryResult: null/undefined coordinates are accepted as 'no signal', never coerced to 0", async () => {
  nextInsertReturns = [{ id: "row-1" }];
  await createDiscoveryResult(validInput({ latitude: null, longitude: undefined }));
  assert.equal(insertedValues[0].latitude, null);
  assert.equal(insertedValues[0].longitude, null);
});

test("createDiscoveryResult: SECURITY — an attacker-shaped input forcing crmClientId/status via a loose cast is never written, since the insert payload is a hand-built literal, never a spread of the input", async () => {
  nextInsertReturns = [{ id: "row-1" }];
  const hostileInput = { ...validInput(), crmClientId: "attacker-controlled-id", status: "converted" };
  await createDiscoveryResult(hostileInput);
  assert.ok(!("crmClientId" in insertedValues[0]));
  assert.ok(!("status" in insertedValues[0]));
});

test("createDiscoveryResult: a conflict (onConflictDoNothing returns empty) re-selects and returns the EXISTING row with created:false, never throws", async () => {
  nextInsertReturns = [];
  nextSelectReturns = [{ id: "existing-row", source: "google_places", sourceId: "abc123" }];
  const { result, created } = await createDiscoveryResult(validInput());
  assert.equal(created, false);
  assert.equal(result.id, "existing-row");
  assert.equal(dbCalls.length, 2, "one insert attempt, one re-select");
});

test("createDiscoveryResult: a conflict whose row cannot be re-read (impossible race) throws loudly rather than silently losing the result", async () => {
  nextInsertReturns = [];
  nextSelectReturns = [];
  await assert.rejects(() => createDiscoveryResult(validInput()));
});

test("findDiscoveryResultBySource: returns null when nothing found", async () => {
  nextSelectReturns = [];
  const result = await findDiscoveryResultBySource("google_places", "does-not-exist");
  assert.equal(result, null);
});

test("findDiscoveryResultBySource: returns the row when found", async () => {
  nextSelectReturns = [{ id: "row-1", source: "google_places", sourceId: "abc123" }];
  const result = await findDiscoveryResultBySource("google_places", "abc123");
  assert.equal(result.id, "row-1");
});
