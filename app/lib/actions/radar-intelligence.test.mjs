// RADAR INTELLIGENCE V1 — Slice 5 — server action orchestration tests.
//
// The advisory CORE (produceRadarAdvisory) is mocked here — its own logic
// is covered by lib/radar-intelligence/advisory-core.test.mjs. This file
// proves the "use server" action's contract:
//   - requireStaffMember("RADAR_QUEUE_VIEW") is the FIRST call; a denial
//     stops everything
//   - identity/scope come from the session only; the action takes just
//     (clientId) — no provider / model / userId / workspace parameter
//   - a per-user in-memory cooldown returns rate_limited on a fast repeat
//   - it delegates to produceRadarAdvisory with the real production deps
//     (getProspectQualification + a display loader + the configured registry)
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-intelligence.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/db", { namedExports: { db: {} } });

let permissionCalls = [];
let denyMode = false;
let evalCalls = [];
let evalOk = false;
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      permissionCalls.push(permission);
      if (denyMode) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "EMPLOYEE";
    },
    // Non-redirecting SYSTEM_ADMIN check used to gate the operator
    // diagnostic. The action passes the SESSION userId (never a client arg).
    evaluateStaffPermission: async ({ userId, permission }) => {
      evalCalls.push({ userId, permission });
      return evalOk ? { ok: true, role: "ADMIN" } : { ok: false, reason: "permission-denied" };
    },
  },
});

let sessionUserId = "user-A";
mock.module("@/lib/session", { namedExports: { requireSession: async () => ({ userId: sessionUserId, role: "staff" }) } });

mock.module("@/lib/actions/radar", { namedExports: { getProspectQualification: async () => ({ qualificationStatus: "QUALIFIED", eligibility: { contactable: true }, opportunity: null }) } });

mock.module("@/lib/radar-intelligence/configured-registry", {
  namedExports: {
    createConfiguredRadarIntelligenceRegistry: () => ({ list: () => [], selectProvider: () => ({ ok: false, error: { code: "NO_CAPABLE_PROVIDER" } }) }),
  },
});

let coreCalls = [];
let coreResult = { status: "unavailable" };
mock.module("@/lib/radar-intelligence/advisory-core", {
  namedExports: {
    produceRadarAdvisory: async (clientId, deps) => {
      coreCalls.push({ clientId, depKeys: Object.keys(deps).sort() });
      return coreResult;
    },
  },
});

const { requestRadarIntelligenceAdvisory } = await import("./radar-intelligence.ts");

const CLIENT = "22222222-2222-4222-8222-222222222222";

function reset() {
  permissionCalls = [];
  denyMode = false;
  coreCalls = [];
  evalCalls = [];
  evalOk = false;
  coreResult = { status: "unavailable" };
  sessionUserId = `user-${Math.random().toString(36).slice(2)}`;
}

test("action: requireStaffMember('RADAR_QUEUE_VIEW') runs first; delegates to the core with production deps", async () => {
  reset();
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.equal(coreCalls.length, 1);
  assert.equal(coreCalls[0].clientId, CLIENT);
  assert.deepEqual(coreCalls[0].depKeys, ["createRegistry", "loadDisplayContext", "loadQualification"].sort());
  assert.deepEqual(r, { status: "unavailable" });
});

test("action: a guard denial propagates — core never runs", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => requestRadarIntelligenceAdvisory(CLIENT), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.equal(coreCalls.length, 0);
});

test("action: signature is (clientId) only — no provider / model / userId / workspace parameter", () => {
  assert.equal(requestRadarIntelligenceAdvisory.length, 1);
});

test("action: per-user cooldown — a fast repeat for the SAME session user returns rate_limited without calling the core", async () => {
  reset();
  sessionUserId = "cooldown-user";
  const first = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(first, { status: "unavailable" });
  const second = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(second, { status: "rate_limited" });
  assert.equal(coreCalls.length, 1, "the core ran only once");
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW", "RADAR_QUEUE_VIEW"], "auth still runs on the throttled call");
});

test("action: a different session user is not throttled by another user's recent request", async () => {
  reset();
  sessionUserId = "user-X";
  await requestRadarIntelligenceAdvisory(CLIENT);
  sessionUserId = "user-Y";
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "unavailable" });
  assert.equal(coreCalls.length, 2);
});

// ---------------- operator diagnostic: SYSTEM_ADMIN-only exposure ----------------

test("diagnostic: a SYSTEM_ADMIN caller receives the coarse failure class verbatim", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX" };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "error", diagnostic: "PROVIDER_4XX" });
  // gated by the SYSTEM_ADMIN permission, checked against the SESSION id
  assert.equal(evalCalls.length, 1);
  assert.equal(evalCalls[0].permission, "SYSTEM_ADMIN");
  assert.equal(evalCalls[0].userId, sessionUserId);
});

for (const label of ["MANAGER", "EMPLOYEE", "any non-admin"]) {
  test(`diagnostic: a ${label} caller gets the safe result with the diagnostic STRIPPED`, async () => {
    reset();
    evalOk = false; // evaluateStaffPermission denies SYSTEM_ADMIN
    coreResult = { status: "error", diagnostic: "PROVIDER_5XX" };
    const r = await requestRadarIntelligenceAdvisory(CLIENT);
    assert.deepEqual(r, { status: "error" });
    assert.equal("diagnostic" in r, false);
    assert.equal(evalCalls.length, 1, "the SYSTEM_ADMIN check still ran");
    assert.equal(evalCalls[0].permission, "SYSTEM_ADMIN");
  });
}

test("diagnostic: the SYSTEM_ADMIN check is SKIPPED when the core result has no diagnostic (common path, no extra RBAC hit)", async () => {
  reset();
  evalOk = true;
  coreResult = { status: "unavailable" };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.deepEqual(r, { status: "unavailable" });
  assert.equal(evalCalls.length, 0);
});

test("diagnostic: an OK advisory is passed straight through — never carries or triggers a diagnostic", async () => {
  reset();
  evalOk = true;
  coreResult = {
    status: "ok",
    summary: "text",
    suggestedNextAction: null,
    generatedAt: "2026-09-13T10:00:00.000Z",
    deterministic: { priority: "HIGH", confidence: "MEDIUM", recommendedNextAction: "FOLLOW_UP_PROPOSAL" },
  };
  const r = await requestRadarIntelligenceAdvisory(CLIENT);
  assert.equal(r.status, "ok");
  assert.equal("diagnostic" in r, false);
  assert.equal(evalCalls.length, 0);
});

test("diagnostic: RADAR_QUEUE_VIEW is still the FIRST gate; the SYSTEM_ADMIN check is additive and never widens access", async () => {
  reset();
  denyMode = true; // requireStaffMember("RADAR_QUEUE_VIEW") denies
  coreResult = { status: "error", diagnostic: "PROVIDER_4XX" };
  await assert.rejects(() => requestRadarIntelligenceAdvisory(CLIENT), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
  assert.equal(coreCalls.length, 0, "core never ran");
  assert.equal(evalCalls.length, 0, "no diagnostic gating on a denied request");
});
