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
mock.module("@/lib/radar-intelligence/advisory-core", {
  namedExports: {
    produceRadarAdvisory: async (clientId, deps) => {
      coreCalls.push({ clientId, depKeys: Object.keys(deps).sort() });
      return { status: "unavailable" };
    },
  },
});

const { requestRadarIntelligenceAdvisory } = await import("./radar-intelligence.ts");

const CLIENT = "22222222-2222-4222-8222-222222222222";

function reset() {
  permissionCalls = [];
  denyMode = false;
  coreCalls = [];
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
