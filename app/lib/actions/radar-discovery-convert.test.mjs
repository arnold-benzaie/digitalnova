// MISSION C-2C-2-C — radar-discovery-convert.ts unit tests. Every
// collaborator is mocked at the module boundary (same technique as
// lib/actions/radar-assignment.test.mjs / lib/actions/radar-discovery-
// search.test.mjs) — no real DB, no real Google call. isValidUuid() is
// deliberately LEFT REAL (pure, already unit-tested on its own).
//
// The REAL transactional row-lock / serialization / rollback / RBAC-by-role
// matrix are proven against a disposable Postgres by
// radar-discovery-convert.integration.test.mjs.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-discovery-convert.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const DISCOVERY_ID = "d15c0000-0000-4000-8000-000000000001";
const SESSION_UUID = "5e551011-0000-4000-8000-000000000001";
const EXISTING_CLIENT_ID = "c11c11c1-0000-4000-8000-000000000002";

// ---- RBAC ----
let permissionCalls = [];
let denyMode = false;
let actorRole = "ADMIN";
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireRadarAccess: async (permission) => {
      permissionCalls.push(permission);
      if (denyMode) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return actorRole;
    },
  },
});

// ---- session ----
let sessionUserId = SESSION_UUID;
let sessionCalls = 0;
mock.module("@/lib/session", {
  namedExports: {
    requireSession: async () => {
      sessionCalls += 1;
      return { userId: sessionUserId, role: "staff" };
    },
  },
});

// ---- CRM dedup ----
let crmMatchCalls = [];
let crmMatchResult = { outcome: "NO_MATCH" };
mock.module("@/lib/crm-client-dedup", {
  namedExports: {
    findCrmClientMatch: async (input) => {
      crmMatchCalls.push(input);
      return crmMatchResult;
    },
  },
});

// ---- audit ----
let auditWrites = [];
let fakeTxRef = null;
mock.module("@/lib/audit", {
  namedExports: {
    logAudit: async (input, executor) => {
      auditWrites.push({ input, handedTx: executor === fakeTxRef });
    },
  },
});

// ---- @/db : transaction + select(FOR UPDATE)/insert/update fake chain ----
let lockedRow = null; // the discovery_results row the locked SELECT resolves to
let selectError = null;
let insertedClient = { id: "new-client-id", name: "placeholder" };
let insertValuesCapture = null;
let updateSetCapture = null;
let updateWhereCalled = false;
let forUpdateUsed = false;
let transactionEntered = false;

function makeSelectBuilder() {
  const b = {
    from: () => b,
    where: () => b,
    for: (mode) => {
      forUpdateUsed = forUpdateUsed || mode === "update";
      return b;
    },
    limit: () => (selectError ? Promise.reject(selectError) : Promise.resolve(lockedRow ? [lockedRow] : [])),
  };
  return b;
}

const fakeTx = {
  select: () => makeSelectBuilder(),
  insert: () => ({
    values: (payload) => {
      insertValuesCapture = payload;
      return { returning: () => Promise.resolve([insertedClient]) };
    },
  }),
  update: () => ({
    set: (payload) => {
      updateSetCapture = payload;
      return {
        where: () => {
          updateWhereCalled = true;
          return Promise.resolve();
        },
      };
    },
  }),
};
fakeTxRef = fakeTx;

const fakeDb = {
  transaction: async (cb) => {
    transactionEntered = true;
    return cb(fakeTx);
  },
};
mock.module("@/db", { namedExports: { db: fakeDb } });

const { convertDiscoveryResult } = await import("./radar-discovery-convert.ts");

function fakeDiscoveryRow(overrides = {}) {
  return {
    id: DISCOVERY_ID,
    source: "google_places",
    sourceId: "ChIJ_place_1",
    name: "Test Place",
    category: "restaurant",
    address: "1 Main St",
    country: "Canada",
    region: "Quebec",
    city: "Montreal",
    postalCode: "H1H 1H1",
    phone: null,
    email: null,
    website: null,
    latitude: 45.5,
    longitude: -73.5,
    timezone: null,
    openingHours: null,
    status: "discovered",
    crmClientId: null,
    ...overrides,
  };
}

function reset() {
  permissionCalls = [];
  denyMode = false;
  actorRole = "ADMIN";
  sessionUserId = SESSION_UUID;
  sessionCalls = 0;
  crmMatchCalls = [];
  crmMatchResult = { outcome: "NO_MATCH" };
  auditWrites = [];
  lockedRow = fakeDiscoveryRow();
  selectError = null;
  insertedClient = { id: "new-client-id", name: "Test Place" };
  insertValuesCapture = null;
  updateSetCapture = null;
  updateWhereCalled = false;
  forUpdateUsed = false;
  transactionEntered = false;
}
test.beforeEach(reset);

// ---- AUTHORIZATION ----

test("AUTHORIZATION: requireRadarAccess('RADAR_WORK') runs first, before any transaction", async () => {
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(permissionCalls, ["RADAR_WORK"]);
});

test("AUTHORIZATION: a denied caller (CLIENT / radar_access=false) rejects with the redirect untouched -- zero DB access", async () => {
  denyMode = true;
  await assert.rejects(() => convertDiscoveryResult(DISCOVERY_ID), /NEXT_REDIRECT/);
  assert.equal(transactionEntered, false);
  assert.equal(sessionCalls, 0);
});

test("the acting identity is ALWAYS requireSession()'s own userId, never accepted from the input", async () => {
  sessionUserId = "actor-from-session";
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.equal(auditWrites[0].input.actorUserId, "actor-from-session");
});

// ---- VALIDATION ----

test("VALIDATION: a syntactically invalid discoveryResultId -> not_found, zero transaction", async () => {
  for (const bad of ["not-a-uuid", "", "  ", "'; DROP TABLE crm_clients; --", 42, null, undefined, {}, []]) {
    reset();
    assert.deepEqual(await convertDiscoveryResult(bad), { status: "not_found" });
    assert.equal(transactionEntered, false, `expected no transaction for ${JSON.stringify(bad)}`);
  }
});

test("VALIDATION: authorization still runs even for a doomed-to-fail input (permission checked before validation)", async () => {
  await convertDiscoveryResult("not-a-uuid");
  assert.deepEqual(permissionCalls, ["RADAR_WORK"]);
});

// ---- NOT FOUND ----

test("NOT_FOUND: no row for a syntactically valid uuid -> not_found, locked read used FOR UPDATE", async () => {
  lockedRow = null;
  const result = await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(result, { status: "not_found" });
  assert.equal(forUpdateUsed, true);
  assert.equal(insertValuesCapture, null);
  assert.equal(updateSetCapture, null);
  assert.deepEqual(auditWrites, []);
});

test("not_found and an invalid uuid are INDISTINGUISHABLE to the caller (same shape)", async () => {
  lockedRow = null;
  const missing = await convertDiscoveryResult(DISCOVERY_ID);
  const invalid = await convertDiscoveryResult("garbage");
  assert.deepEqual(missing, invalid);
});

// ---- ALREADY CONVERTED (idempotence) ----

test("ALREADY_CONVERTED: a row already status='converted' returns its existing crmClientId, ZERO writes", async () => {
  lockedRow = fakeDiscoveryRow({ status: "converted", crmClientId: EXISTING_CLIENT_ID });
  const result = await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(result, { status: "already_converted", crmClientId: EXISTING_CLIENT_ID });
  assert.equal(insertValuesCapture, null, "no crm_clients insert on an already-converted row");
  assert.equal(updateSetCapture, null, "no discovery_results update on an already-converted row");
  assert.deepEqual(crmMatchCalls, [], "dedup is never re-run once already converted");
  assert.deepEqual(auditWrites, []);
});

// ---- DEDUP: re-run inside the transaction, never the search-time result ----

test("DEDUP: findCrmClientMatch is called with the ROW's own persisted fields, never the search-time result", async () => {
  lockedRow = fakeDiscoveryRow({ name: "Fresh Name", email: "e@x.test", phone: "+15145550000", city: "Laval", region: "Quebec", country: "Canada" });
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(crmMatchCalls[0], { name: "Fresh Name", email: "e@x.test", phone: "+15145550000", city: "Laval", region: "Quebec", country: "Canada" });
});

test("EXACT_MATCH: already_in_crm, ZERO writes, response carries ONLY 'status'", async () => {
  crmMatchResult = { outcome: "EXACT_MATCH", clientId: "SECRET-HIDDEN-CLIENT-ID", matchedSignals: ["email"], confidence: "HIGH", reason: "internal reasoning" };
  const result = await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(result, { status: "already_in_crm" });
  assert.deepEqual(Object.keys(result), ["status"]);
  assert.equal(insertValuesCapture, null);
  assert.equal(updateSetCapture, null);
  assert.deepEqual(auditWrites, []);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("SECRET-HIDDEN-CLIENT-ID"));
  assert.ok(!serialized.includes("matchedSignals"));
  assert.ok(!serialized.includes("confidence"));
  assert.ok(!serialized.includes("internal reasoning"));
});

test("AMBIGUOUS_MATCH: ambiguous_match, ZERO writes, response carries ONLY 'status', no candidateClientIds", async () => {
  crmMatchResult = { outcome: "AMBIGUOUS_MATCH", candidateClientIds: ["hidden-1", "hidden-2"], matchedSignals: ["name_location"], confidence: "MEDIUM", reason: "x" };
  const result = await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(result, { status: "ambiguous_match" });
  assert.deepEqual(Object.keys(result), ["status"]);
  assert.equal(insertValuesCapture, null);
  assert.equal(updateSetCapture, null);
  assert.deepEqual(auditWrites, []);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("hidden-1"));
  assert.ok(!serialized.includes("hidden-2"));
  assert.ok(!serialized.includes("candidateClientIds"));
});

// ---- NO_MATCH: creation ----

test("NO_MATCH: creates the crm_client with an EXPLICIT literal -- never a spread of the discovery row", async () => {
  lockedRow = fakeDiscoveryRow({
    name: "Le Petit Café", address: "1 Main St", country: "Canada", region: "Quebec", city: "Montreal",
    phone: "+15145550000", email: "e@x.test", postalCode: "H1H 1H1",
    category: "restaurant", website: "https://example.test", latitude: 45.5, longitude: -73.5,
  });
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(insertValuesCapture, {
    name: "Le Petit Café",
    address: "1 Main St",
    country: "Canada",
    region: "Quebec",
    city: "Montreal",
    phone: "+15145550000",
    email: "e@x.test",
    postalCode: "H1H 1H1",
    source: "RADAR Discovery",
    stage: "lead",
    assignedUserId: null,
  });
  // NEVER mapped, per the C-2C-2-B contract:
  assert.equal("category" in insertValuesCapture, false);
  assert.equal("industry" in insertValuesCapture, false);
  assert.equal("website" in insertValuesCapture, false);
  assert.equal("notes" in insertValuesCapture, false);
  assert.equal("latitude" in insertValuesCapture, false);
  assert.equal("longitude" in insertValuesCapture, false);
  assert.equal("organizationId" in insertValuesCapture, false);
});

test("NO_MATCH: updates discovery_results to status='converted' with the new crmClientId", async () => {
  insertedClient = { id: "brand-new-client-id", name: "Test Place" };
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(updateSetCapture, { status: "converted", crmClientId: "brand-new-client-id" });
  assert.equal(updateWhereCalled, true);
});

test("NO_MATCH: returns converted + the new crmClientId", async () => {
  insertedClient = { id: "brand-new-client-id", name: "Test Place" };
  const result = await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(result, { status: "converted", crmClientId: "brand-new-client-id" });
});

// ---- ASSIGNMENT: role-derived, never caller-controlled ----

test("ASSIGNMENT: EMPLOYEE actor -> assignedUserId is the actor's OWN session userId", async () => {
  actorRole = "EMPLOYEE";
  sessionUserId = "employee-user-id";
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.equal(insertValuesCapture.assignedUserId, "employee-user-id");
});

test("ASSIGNMENT: OWNER/ADMIN/MANAGER actors -> assignedUserId is null", async () => {
  for (const role of ["OWNER", "ADMIN", "MANAGER"]) {
    reset();
    actorRole = role;
    await convertDiscoveryResult(DISCOVERY_ID);
    assert.equal(insertValuesCapture.assignedUserId, null, `expected null for role ${role}`);
  }
});

test("ASSIGNMENT: assignedUserId can never be influenced by the discoveryResultId input (no such channel exists)", async () => {
  actorRole = "EMPLOYEE";
  sessionUserId = "real-employee-id";
  // discoveryResultId is the ONLY input parameter; it carries no
  // assignedUserId/userId/role field at all -- this is a structural
  // guarantee, exercised here by confirming the string input alone still
  // resolves the assignment from the session, never from itself.
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.equal(insertValuesCapture.assignedUserId, "real-employee-id");
});

// ---- AUDIT ----

test("AUDIT: exactly one logAudit call, handed the SAME transaction executor, with the exact documented shape", async () => {
  insertedClient = { id: "brand-new-client-id", name: "Test Place" };
  lockedRow = fakeDiscoveryRow({ source: "google_places", sourceId: "ChIJ_place_1" });
  sessionUserId = "actor-1";
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.equal(auditWrites.length, 1);
  assert.equal(auditWrites[0].handedTx, true);
  assert.deepEqual(auditWrites[0].input, {
    actorUserId: "actor-1",
    action: "radar.discovery_result_converted",
    targetType: "crm_client",
    targetId: "brand-new-client-id",
    metadata: { discoveryResultId: DISCOVERY_ID, source: "google_places", sourceId: "ChIJ_place_1" },
  });
});

test("AUDIT: no audit write on already_in_crm / ambiguous_match / already_converted / not_found", async () => {
  crmMatchResult = { outcome: "EXACT_MATCH" };
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(auditWrites, []);

  reset();
  crmMatchResult = { outcome: "AMBIGUOUS_MATCH" };
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(auditWrites, []);

  reset();
  lockedRow = fakeDiscoveryRow({ status: "converted", crmClientId: EXISTING_CLIENT_ID });
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(auditWrites, []);

  reset();
  lockedRow = null;
  await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(auditWrites, []);
});

// ---- SECURITY ----

test("SECURITY: the full result never contains any string resembling an API key", async () => {
  const result = await convertDiscoveryResult(DISCOVERY_ID);
  assert.ok(!JSON.stringify(result).match(/AIza|api[_-]?key/i));
});

test("SECURITY: converted/already_converted results carry ONLY status/crmClientId -- never any other CRM field", async () => {
  insertedClient = { id: "brand-new-client-id", name: "Test Place" };
  const created = await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(Object.keys(created).sort(), ["crmClientId", "status"]);

  reset();
  lockedRow = fakeDiscoveryRow({ status: "converted", crmClientId: EXISTING_CLIENT_ID });
  const already = await convertDiscoveryResult(DISCOVERY_ID);
  assert.deepEqual(Object.keys(already).sort(), ["crmClientId", "status"]);
});
