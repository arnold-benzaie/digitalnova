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

// ---- MISSION C-2D-4-E — audit (used only by finalizeDiscoveryResultEnrichment) ----
let auditWrites = [];
let fakeTxRef = null;
mock.module("@/lib/audit", {
  namedExports: {
    logAudit: async (input, executor) => {
      auditWrites.push({ input, handedTx: executor === fakeTxRef });
    },
  },
});

/** @type {Array<Record<string, unknown>>} */
let insertedValues = [];
/** @type {any[]} rows returned by the NEXT insert().onConflictDoNothing().returning() call */
let nextInsertReturns = [];
/** @type {any[]} rows returned by the NEXT select().from().where().limit() call, unless selectQueue is set */
let nextSelectReturns = [];
/** @type {any[][] | null} when set, each select().from().where().limit() call shifts ONE row-set off
 * this queue instead of returning nextSelectReturns -- lets a single test
 * script two DIFFERENT sequential select() calls (e.g. claimDiscoveryResultForEnrichment's
 * own initial read + its re-read-on-race path). `null` preserves the
 * original single-shot behavior every pre-existing test already relies on. */
let selectQueue = null;
/** @type {Array<{ kind: string }>} */
let dbCalls = [];

// ---- MISSION C-2D-4-E — non-transactional update() (claim / release) ----
/** @type {any[]} rows returned by the NEXT (non-transactional) update().set().where().returning() call */
let nextUpdateReturns = [];
/** @type {Array<Record<string, unknown>>} */
let updateSetCaptures = [];
/** @type {Array<unknown>} each entry is the exact `where(...)` condition list passed */
let updateWhereCaptures = [];

// ---- MISSION C-2D-4-E — transaction() (finalizeDiscoveryResultEnrichment) ----
/** @type {any[]} rows returned by tx.select()...for("update").limit() */
let fakeTxSelectReturns = [];
/** @type {any[]} rows returned by tx.update().set().where().returning() */
let fakeTxUpdateReturns = [];
let fakeTxUpdateSetCapture = null;
let fakeTxForUpdateUsed = false;
let transactionEntered = false;

function makeTxSelectBuilder() {
  const b = {
    from: () => b,
    where: () => b,
    for: (mode) => {
      fakeTxForUpdateUsed = fakeTxForUpdateUsed || mode === "update";
      return b;
    },
    limit: () => Promise.resolve(fakeTxSelectReturns),
  };
  return b;
}

const fakeTx = {
  select: () => makeTxSelectBuilder(),
  update: () => ({
    set: (payload) => {
      fakeTxUpdateSetCapture = payload;
      return {
        where: () => ({
          returning: () => Promise.resolve(fakeTxUpdateReturns),
        }),
      };
    },
  }),
};
fakeTxRef = fakeTx;

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
          if (selectQueue && selectQueue.length > 0) {
            return Promise.resolve(selectQueue.shift());
          }
          return Promise.resolve(nextSelectReturns);
        },
      }),
    }),
  }),
  // MISSION C-2D-4-E — non-transactional update, used by
  // claimDiscoveryResultForEnrichment() (with .returning()) and
  // releaseDiscoveryResultEnrichmentClaim() (without it) — a bare
  // `.where(...)` must itself be awaitable AND still carry a `.returning`
  // method, mirroring drizzle's own real query-builder shape.
  update: () => ({
    set: (payload) => {
      updateSetCaptures.push(payload);
      return {
        where: (...args) => {
          updateWhereCaptures.push(args);
          dbCalls.push({ kind: "update" });
          const resultPromise = Promise.resolve(undefined);
          resultPromise.returning = () => Promise.resolve(nextUpdateReturns);
          return resultPromise;
        },
      };
    },
  }),
  transaction: async (cb) => {
    transactionEntered = true;
    return cb(fakeTx);
  },
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const {
  createDiscoveryResult,
  findDiscoveryResultBySource,
  DISCOVERY_RESULT_STATUSES,
  claimDiscoveryResultForEnrichment,
  releaseDiscoveryResultEnrichmentClaim,
  finalizeDiscoveryResultEnrichment,
  ENRICHMENT_LEASE_SECONDS,
} = await import("./discovery-result-store.ts");

function reset() {
  insertedValues = [];
  nextInsertReturns = [];
  nextSelectReturns = [];
  selectQueue = null;
  dbCalls = [];
  nextUpdateReturns = [];
  updateSetCaptures = [];
  updateWhereCaptures = [];
  fakeTxSelectReturns = [];
  fakeTxUpdateReturns = [];
  fakeTxUpdateSetCapture = null;
  fakeTxForUpdateUsed = false;
  transactionEntered = false;
  auditWrites = [];
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

// ---- MISSION C-2D-4-E — Enrichment Engine: claim / lease --------------

function claimableRow(overrides = {}) {
  return { id: "row-1", source: "google_places", sourceId: "abc123", name: "Test Business", status: "discovered", enrichmentClaimedAt: null, crmClientId: null, ...overrides };
}

test("claimDiscoveryResultForEnrichment: not_found when the row does not exist", async () => {
  nextSelectReturns = [];
  const outcome = await claimDiscoveryResultForEnrichment("missing-id", { forceRefresh: false });
  assert.deepEqual(outcome, { status: "not_found" });
});

test("claimDiscoveryResultForEnrichment: ignored -- refused immediately, never attempts the atomic UPDATE at all", async () => {
  nextSelectReturns = [claimableRow({ status: "ignored" })];
  const outcome = await claimDiscoveryResultForEnrichment("row-1", { forceRefresh: false });
  assert.deepEqual(outcome, { status: "ignored" });
  assert.equal(updateSetCaptures.length, 0, "an ignored row must never even attempt the claim UPDATE");
});

test("claimDiscoveryResultForEnrichment: ignored is refused EVEN with forceRefresh:true -- forceRefresh never resurrects a dismissed result", async () => {
  nextSelectReturns = [claimableRow({ status: "ignored" })];
  const outcome = await claimDiscoveryResultForEnrichment("row-1", { forceRefresh: true });
  assert.deepEqual(outcome, { status: "ignored" });
});

test("claimDiscoveryResultForEnrichment: already_enriched (forceRefresh false) -- refused immediately, returns the existing row, never attempts the UPDATE", async () => {
  const row = claimableRow({ status: "enriched", phone: "+123" });
  nextSelectReturns = [row];
  const outcome = await claimDiscoveryResultForEnrichment("row-1", { forceRefresh: false });
  assert.equal(outcome.status, "already_enriched");
  assert.equal(outcome.row.phone, "+123");
  assert.equal(updateSetCaptures.length, 0);
});

test("claimDiscoveryResultForEnrichment: forceRefresh:true on an already-enriched row proceeds to attempt the claim UPDATE", async () => {
  nextSelectReturns = [claimableRow({ status: "enriched" })];
  nextUpdateReturns = [claimableRow({ status: "enriched", enrichmentClaimedAt: new Date() })];
  const outcome = await claimDiscoveryResultForEnrichment("row-1", { forceRefresh: true });
  assert.equal(outcome.status, "claimed");
  assert.equal(updateSetCaptures.length, 1);
});

test("claimDiscoveryResultForEnrichment: a claimable discovered row succeeds -- sets enrichmentClaimedAt to a fresh Date, returns 'claimed'", async () => {
  nextSelectReturns = [claimableRow()];
  const claimedRow = claimableRow({ enrichmentClaimedAt: new Date() });
  nextUpdateReturns = [claimedRow];
  const before = Date.now();
  const outcome = await claimDiscoveryResultForEnrichment("row-1", { forceRefresh: false });
  assert.equal(outcome.status, "claimed");
  assert.equal(outcome.row, claimedRow);
  assert.equal(updateSetCaptures.length, 1);
  assert.ok(updateSetCaptures[0].enrichmentClaimedAt instanceof Date);
  assert.ok(updateSetCaptures[0].enrichmentClaimedAt.getTime() >= before);
});

test("claimDiscoveryResultForEnrichment: converted row is claimable exactly like discovered (mission: enrichment continues after conversion)", async () => {
  nextSelectReturns = [claimableRow({ status: "converted", crmClientId: "some-client-id" })];
  nextUpdateReturns = [claimableRow({ status: "converted" })];
  const outcome = await claimDiscoveryResultForEnrichment("row-1", { forceRefresh: false });
  assert.equal(outcome.status, "claimed");
});

test("claimDiscoveryResultForEnrichment: RACE -- initial read looks claimable, but the atomic UPDATE matches zero rows (another claimant won) -> enrichment_in_progress, re-read for a precise reason", async () => {
  selectQueue = [[claimableRow()], [claimableRow({ enrichmentClaimedAt: new Date() })]];
  nextUpdateReturns = []; // the atomic UPDATE lost the race
  const outcome = await claimDiscoveryResultForEnrichment("row-1", { forceRefresh: false });
  assert.deepEqual(outcome, { status: "enrichment_in_progress" });
  assert.equal(dbCalls.filter((c) => c.kind === "select").length, 2, "initial read + one re-read on race, never more");
});

test("claimDiscoveryResultForEnrichment: RACE -- the row was converted-and-something-changed between read and UPDATE such that it is now genuinely gone -> not_found on re-read", async () => {
  selectQueue = [[claimableRow()], []];
  nextUpdateReturns = [];
  const outcome = await claimDiscoveryResultForEnrichment("row-1", { forceRefresh: false });
  assert.deepEqual(outcome, { status: "not_found" });
});

// ---- MISSION C-2D-4-E — Enrichment Engine: release -------------------

test("releaseDiscoveryResultEnrichmentClaim: issues an UPDATE clearing enrichmentClaimedAt to null", async () => {
  await releaseDiscoveryResultEnrichmentClaim("row-1", new Date());
  assert.equal(updateSetCaptures.length, 1);
  assert.deepEqual(updateSetCaptures[0], { enrichmentClaimedAt: null });
});

test("releaseDiscoveryResultEnrichmentClaim: never throws even when the update affects zero rows (already released/reclaimed is a normal, safe outcome)", async () => {
  await assert.doesNotReject(() => releaseDiscoveryResultEnrichmentClaim("row-1", new Date()));
});

// ---- MISSION C-2D-4-E — Enrichment Engine: finalize (transactional) ---

function enrichmentPatch(overrides = {}) {
  return { phone: "+33 1 42 00 00 01", website: "https://example.test", openingHours: { periods: [] }, businessStatus: "OPERATIONAL", ...overrides };
}

test("finalizeDiscoveryResultEnrichment: uses a real transaction with SELECT ... FOR UPDATE before writing anything", async () => {
  const claimedAt = new Date();
  fakeTxSelectReturns = [claimableRow({ status: "discovered", enrichmentClaimedAt: claimedAt })];
  fakeTxUpdateReturns = [claimableRow({ status: "enriched", ...enrichmentPatch() })];
  await finalizeDiscoveryResultEnrichment("row-1", claimedAt, enrichmentPatch(), "actor-user-1");
  assert.equal(transactionEntered, true);
  assert.equal(fakeTxForUpdateUsed, true, "the row must be locked with FOR UPDATE before merging");
});

test("finalizeDiscoveryResultEnrichment: lease_lost when the row no longer exists", async () => {
  fakeTxSelectReturns = [];
  const outcome = await finalizeDiscoveryResultEnrichment("row-1", new Date(), enrichmentPatch(), "actor-user-1");
  assert.deepEqual(outcome, { status: "lease_lost" });
});

test("finalizeDiscoveryResultEnrichment: lease_lost when the row's lease was already released (enrichmentClaimedAt is null)", async () => {
  fakeTxSelectReturns = [claimableRow({ enrichmentClaimedAt: null })];
  const outcome = await finalizeDiscoveryResultEnrichment("row-1", new Date(), enrichmentPatch(), "actor-user-1");
  assert.deepEqual(outcome, { status: "lease_lost" });
});

test("finalizeDiscoveryResultEnrichment: lease_lost when the row's current lease timestamp does not match the one this call was claimed with", async () => {
  fakeTxSelectReturns = [claimableRow({ enrichmentClaimedAt: new Date("2026-01-01T00:00:00Z") })];
  const outcome = await finalizeDiscoveryResultEnrichment("row-1", new Date("2026-01-01T00:00:01Z"), enrichmentPatch(), "actor-user-1");
  assert.deepEqual(outcome, { status: "lease_lost" });
});

test("finalizeDiscoveryResultEnrichment: a discovered row transitions to 'enriched', merges exactly the four patch fields, sets updatedAt, clears the lease", async () => {
  const claimedAt = new Date();
  fakeTxSelectReturns = [claimableRow({ status: "discovered", enrichmentClaimedAt: claimedAt })];
  fakeTxUpdateReturns = [claimableRow({ status: "enriched", ...enrichmentPatch(), enrichmentClaimedAt: null })];
  const outcome = await finalizeDiscoveryResultEnrichment("row-1", claimedAt, enrichmentPatch(), "actor-user-1");
  assert.equal(outcome.status, "enriched");
  assert.deepEqual(Object.keys(fakeTxUpdateSetCapture).sort(), ["businessStatus", "enrichmentClaimedAt", "openingHours", "phone", "status", "updatedAt", "website"].sort());
  assert.equal(fakeTxUpdateSetCapture.status, "enriched");
  assert.equal(fakeTxUpdateSetCapture.enrichmentClaimedAt, null);
  assert.ok(fakeTxUpdateSetCapture.updatedAt instanceof Date);
  assert.equal(fakeTxUpdateSetCapture.phone, "+33 1 42 00 00 01");
  assert.equal(fakeTxUpdateSetCapture.website, "https://example.test");
  assert.equal(fakeTxUpdateSetCapture.businessStatus, "OPERATIONAL");
});

test("finalizeDiscoveryResultEnrichment: a CONVERTED row stays 'converted' -- enrichment fields are merged, but status is NEVER downgraded away from converted", async () => {
  const claimedAt = new Date();
  fakeTxSelectReturns = [claimableRow({ status: "converted", crmClientId: "existing-crm-id", enrichmentClaimedAt: claimedAt })];
  fakeTxUpdateReturns = [claimableRow({ status: "converted" })];
  await finalizeDiscoveryResultEnrichment("row-1", claimedAt, enrichmentPatch(), "actor-user-1");
  assert.equal(fakeTxUpdateSetCapture.status, "converted", "converted must never be overwritten by 'enriched'");
});

test("finalizeDiscoveryResultEnrichment: a null businessStatus/phone/website (Google confirmed empty) is written as null, never skipped", async () => {
  const claimedAt = new Date();
  fakeTxSelectReturns = [claimableRow({ status: "discovered", enrichmentClaimedAt: claimedAt })];
  fakeTxUpdateReturns = [claimableRow({ status: "enriched" })];
  await finalizeDiscoveryResultEnrichment("row-1", claimedAt, { phone: null, website: null, openingHours: null, businessStatus: null }, "actor-user-1");
  assert.equal(fakeTxUpdateSetCapture.phone, null);
  assert.equal(fakeTxUpdateSetCapture.website, null);
  assert.equal(fakeTxUpdateSetCapture.businessStatus, null);
});

test("finalizeDiscoveryResultEnrichment: writes an audit entry in the SAME transaction (the same tx executor object is handed to logAudit)", async () => {
  const claimedAt = new Date();
  fakeTxSelectReturns = [claimableRow({ status: "discovered", sourceId: "abc123", enrichmentClaimedAt: claimedAt })];
  fakeTxUpdateReturns = [claimableRow({ status: "enriched" })];
  await finalizeDiscoveryResultEnrichment("row-1", claimedAt, enrichmentPatch(), "actor-user-42");
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0].handedTx, true, "logAudit must receive the SAME tx, never db or a re-resolved session");
  assert.equal(auditWrites[0].input.actorUserId, "actor-user-42");
  assert.equal(auditWrites[0].input.action, "radar.discovery_result_enriched");
  assert.equal(auditWrites[0].input.targetType, "discovery_result");
  assert.equal(auditWrites[0].input.targetId, "row-1");
});

test("finalizeDiscoveryResultEnrichment: SECURITY -- the audit metadata never contains a raw provider payload, only source/sourceId", async () => {
  const claimedAt = new Date();
  fakeTxSelectReturns = [claimableRow({ status: "discovered", source: "google_places", sourceId: "abc123", enrichmentClaimedAt: claimedAt })];
  fakeTxUpdateReturns = [claimableRow({ status: "enriched" })];
  await finalizeDiscoveryResultEnrichment("row-1", claimedAt, enrichmentPatch(), "actor-user-1");
  assert.deepEqual(Object.keys(auditWrites[0].input.metadata).sort(), ["source", "sourceId"].sort());
});

test("ENRICHMENT_LEASE_SECONDS is a positive number, comfortably longer than the transport timeout + one retry", () => {
  assert.equal(typeof ENRICHMENT_LEASE_SECONDS, "number");
  assert.ok(ENRICHMENT_LEASE_SECONDS > 0);
  assert.ok(ENRICHMENT_LEASE_SECONDS >= 60, "must comfortably exceed the ~16s worst-case single-attempt duration (8s timeout x up to 2 attempts)");
});
