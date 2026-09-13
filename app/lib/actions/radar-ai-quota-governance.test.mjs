// RADAR INTELLIGENCE V2.1 — Phase G4C-2 — lib/actions/radar-ai-quota-governance.ts tests.
//
// @/lib/rbac/require-staff-member, @/lib/radar-intelligence/quota-policy-store
// and @/lib/radar-intelligence/quota-counter-store are mocked at the module
// boundary -- this suite touches no live Postgres connection, no Next.js
// runtime, and dispatches zero provider calls. quota-status.ts (G4C-1) is
// DELIBERATELY NOT mocked here: the real, already-unit-tested
// computeRadarAiQuotaStatus drives every classification outcome below, so
// these tests prove genuine end-to-end delegation rather than a
// coincidental match against a second, parallel implementation. A
// structural check further down proves the action's own source contains
// no threshold comparison of its own.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-ai-quota-governance.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

/** @type {string} "OWNER" succeeds; "DENY" throws NEXT_REDIRECT. */
let permissionMode = "OWNER";
let permissionCalls = [];
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireStaffMember: async (permission) => {
      permissionCalls.push(permission);
      if (permissionMode === "DENY") {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return permissionMode;
    },
  },
});

const DEFAULT_POLICY = { enabled: true, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 };

/** @type {{ status: "ok" | "missing" | "error"; policy: object | null }} */
let policyFixture = { status: "ok", policy: DEFAULT_POLICY };
let policyCalls = 0;
mock.module("@/lib/radar-intelligence/quota-policy-store", {
  namedExports: {
    loadRadarAiQuotaPolicyWithStatus: async () => {
      policyCalls += 1;
      return policyFixture;
    },
  },
});

/** @type {{ throws?: boolean; counter: { key: string; requestCount: number; tokenCount: number; windowStart: Date } | null }} */
let counterFixture = { throws: false, counter: null };
let counterCalls = 0;
mock.module("@/lib/radar-intelligence/quota-counter-store", {
  namedExports: {
    readGlobalQuotaCounter: async () => {
      counterCalls += 1;
      if (counterFixture.throws) throw new Error("simulated counter store failure");
      return counterFixture.counter;
    },
  },
});

const { getRadarAiQuotaGovernanceSnapshot } = await import("./radar-ai-quota-governance.ts");
const SOURCE = readFileSync(fileURLToPath(new URL("./radar-ai-quota-governance.ts", import.meta.url)), "utf8");

function counterRow(requestCount, tokenCount) {
  return { key: "global:2026-09-13", requestCount, tokenCount, windowStart: new Date("2026-09-13T00:00:00.000Z") };
}

test.beforeEach(() => {
  permissionMode = "OWNER";
  permissionCalls = [];
  policyFixture = { status: "ok", policy: DEFAULT_POLICY };
  policyCalls = 0;
  counterFixture = { throws: false, counter: null };
  counterCalls = 0;
});

// ---------------- authorization ----------------

test("1. OWNER authorized: succeeds and checks RADAR_AI_POLICY_MANAGE exactly once", async () => {
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
  assert.equal(snapshot.quotaStatus, "NORMAL");
});

test("2. a denied caller (ADMIN/MANAGER/EMPLOYEE bucket) is rejected before any store read", async () => {
  permissionMode = "DENY";
  await assert.rejects(() => getRadarAiQuotaGovernanceSnapshot(), (err) => err.digest === "NEXT_REDIRECT;replace;/admin;307;");
  assert.equal(policyCalls, 0);
  assert.equal(counterCalls, 0);
});

test("never uses SYSTEM_ADMIN, ANALYTICS_TEAM_VIEW, or a new permission -- only RADAR_AI_POLICY_MANAGE", async () => {
  await getRadarAiQuotaGovernanceSnapshot();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
});

test("takes no client-supplied argument that could carry a forged role or permission", () => {
  assert.equal(getRadarAiQuotaGovernanceSnapshot.length, 0);
});

// ---------------- 3. policy available + counter available ----------------

test("3. policy ok + counter ok, enabled, limits configured, low usage -> NORMAL with full usage detail", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: 10_000, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(5, 500) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "NORMAL");
  assert.equal(snapshot.enabled, true);
  assert.equal(snapshot.requestCount, 5);
  assert.equal(snapshot.tokenCount, 500);
  assert.equal(counterCalls, 1);
});

// ---------------- 4. policy disabled ----------------

test("4. policy.enabled = false -> DISABLED, no usage fields, counter never read", async () => {
  policyFixture = { status: "ok", policy: { enabled: false, dailyRequestLimit: 10, dailyTokenLimit: 1000, warningThresholdPercent: 80 } };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "DISABLED");
  assert.equal(snapshot.enabled, false);
  assert.equal(snapshot.dailyRequestLimit, 10);
  assert.equal(snapshot.dailyTokenLimit, 1000);
  assert.equal(counterCalls, 0, "counter must never be read once disabled is known");
  assert.deepEqual(Object.keys(snapshot).sort(), ["dailyRequestLimit", "dailyTokenLimit", "enabled", "quotaStatus", "warningThresholdPercent"].sort());
});

test("4b. disabled AND the counter store is broken -> still DISABLED, never UNAVAILABLE (counter is irrelevant once disabled)", async () => {
  policyFixture = { status: "ok", policy: { enabled: false, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  counterFixture = { throws: true, counter: null };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "DISABLED");
  assert.equal(counterCalls, 0);
});

// ---------------- 5. quota unlimited ----------------

test("5. both limits null (unlimited) -> NORMAL, counter never read, no usage percent/remaining implied by a fabricated limit", async () => {
  policyFixture = { status: "ok", policy: DEFAULT_POLICY };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "NORMAL");
  assert.equal(snapshot.requestRemaining, null);
  assert.equal(snapshot.tokenRemaining, null);
  assert.equal(snapshot.requestUsagePercent, null);
  assert.equal(snapshot.tokenUsagePercent, null);
  assert.equal(counterCalls, 0, "counter is never read when no limit could ever be reached");
});

// ---------------- 6. warning ----------------

test("6. usage at exactly the warning threshold -> WARNING", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(80, 0) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "WARNING");
  assert.equal(snapshot.requestUsagePercent, 80);
});

// ---------------- 7. limited ----------------

test("7. requestCount >= limit -> LIMITED", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(100, 0) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "LIMITED");
  assert.equal(snapshot.requestRemaining, 0);
});

// ---------------- 8. request remaining ----------------

test("8. requestRemaining is limit minus current count, clamped at 0", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(37, 0) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.requestRemaining, 63);
});

test("8b. requestRemaining never goes negative even if the stored count overshoots the limit", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(150, 0) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.requestRemaining, 0);
  assert.equal(snapshot.requestUsagePercent, 150, "usagePercent is NOT clamped -- a genuine overshoot must stay visible");
});

// ---------------- 9. token remaining ----------------

test("9. tokenRemaining is limit minus current token count, clamped at 0", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: 10_000, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(0, 3_000) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.tokenRemaining, 7_000);
  assert.equal(snapshot.tokenUsagePercent, 30);
});

// ---------------- 10. null limit ----------------

test("10. a null dailyRequestLimit alone is reported as unlimited -- never a percent/remaining, however high the count", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: 1000, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(999_999, 10) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.requestRemaining, null);
  assert.equal(snapshot.requestUsagePercent, null);
  assert.equal(snapshot.requestCount, 999_999, "the raw count is still reported -- only remaining/percent are suppressed for an unlimited resource");
});

// ---------------- 11. limit = 0 ----------------

test("11. dailyRequestLimit = 0 -> LIMITED immediately; remaining=0, usagePercent=100, regardless of the stored count", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 0, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: null };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "LIMITED");
  assert.equal(snapshot.requestRemaining, 0);
  assert.equal(snapshot.requestUsagePercent, 100);
});

test("11b. dailyTokenLimit = 0 -> LIMITED; tokenRemaining=0, tokenUsagePercent=100", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: 0, warningThresholdPercent: 80 } };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "LIMITED");
  assert.equal(snapshot.tokenRemaining, 0);
  assert.equal(snapshot.tokenUsagePercent, 100);
});

// ---------------- 12. policy store error ----------------

test("12. policy store error -> UNAVAILABLE, no other field, no default policy fabricated, counter never read", async () => {
  policyFixture = { status: "error", policy: null };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.deepEqual(snapshot, { quotaStatus: "UNAVAILABLE" });
  assert.equal(counterCalls, 0, "counter is never read once the policy itself is unknown");
});

test("12b. policy status 'missing' (never configured) is NOT an UNAVAILABLE condition -- uses the safe default policy like G4B-2's own contract", async () => {
  policyFixture = { status: "missing", policy: DEFAULT_POLICY };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "NORMAL");
});

// ---------------- 13. counter store error ----------------

test("13. policy ok + a configured limit + counter store error -> UNAVAILABLE, no fabricated usage numbers", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  counterFixture = { throws: true, counter: null };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.deepEqual(snapshot, { quotaStatus: "UNAVAILABLE" });
  assert.equal(counterCalls, 1, "the counter WAS actually attempted here -- a limit is configured, so it could matter");
});

// ---------------- 14 / 15. mixed configurations ----------------

test("14. request limited / token unlimited -> LIMITED, token fields report unlimited", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(10, 999_999) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "LIMITED");
  assert.equal(snapshot.requestRemaining, 0);
  assert.equal(snapshot.tokenRemaining, null);
  assert.equal(snapshot.tokenUsagePercent, null);
});

test("15. request unlimited / token limited -> LIMITED, request fields report unlimited", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: null, dailyTokenLimit: 5000, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(999_999, 5000) };
  const snapshot = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(snapshot.quotaStatus, "LIMITED");
  assert.equal(snapshot.tokenRemaining, 0);
  assert.equal(snapshot.requestRemaining, null);
  assert.equal(snapshot.requestUsagePercent, null);
});

// ---------------- 16. stable / serializable ----------------

test("16. the snapshot is plain-JSON serializable and stable across repeated calls with identical fixtures", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: 10_000, warningThresholdPercent: 80 } };
  counterFixture = { throws: false, counter: counterRow(10, 100) };
  const first = await getRadarAiQuotaGovernanceSnapshot();
  const second = await getRadarAiQuotaGovernanceSnapshot();
  assert.deepEqual(first, second);
  assert.doesNotThrow(() => JSON.stringify(first));
  const roundTripped = JSON.parse(JSON.stringify(first));
  assert.deepEqual(roundTripped, first);
});

test("16b. the DISABLED and UNAVAILABLE shapes are also stable and serializable", async () => {
  policyFixture = { status: "ok", policy: { enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 } };
  const disabled = await getRadarAiQuotaGovernanceSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(disabled)), disabled);

  policyFixture = { status: "error", policy: null };
  const unavailable = await getRadarAiQuotaGovernanceSnapshot();
  assert.deepEqual(JSON.parse(JSON.stringify(unavailable)), unavailable);
});

// ---------------- 17. no secrets ----------------

test("17. no secret, credential, API key, raw DB row, or provider identity anywhere in any snapshot shape", async () => {
  const scenarios = [
    { status: "error", policy: null },
    { status: "ok", policy: { enabled: false, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 } },
    { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: 10_000, warningThresholdPercent: 80 } },
  ];
  for (const scenario of scenarios) {
    policyFixture = scenario;
    counterFixture = { throws: false, counter: counterRow(1, 1) };
    const snapshot = await getRadarAiQuotaGovernanceSnapshot();
    const serialized = JSON.stringify(snapshot);
    assert.equal(/apiKey|Authorization|Bearer|password|secret|credential|sk-ant-|sk-proj-|DATABASE_URL|updatedByStaffMemberId|staffMemberId|windowStart|key["\s:]/i.test(serialized), false);
  }
});

// ---------------- delegation to computeRadarAiQuotaStatus, not a parallel implementation ----------------

test("delegation: imports and calls the real computeRadarAiQuotaStatus exactly once in the source; no duplicated threshold logic", () => {
  assert.match(SOURCE, /import\s*\{[^}]*computeRadarAiQuotaStatus[^}]*\}\s*from\s*"@\/lib\/radar-intelligence\/quota-status"/);
  assert.equal((SOURCE.match(/computeRadarAiQuotaStatus\(/g) || []).length, 1, "the classification function must be called exactly once, never duplicated");
  // The action's own shaping code must never re-implement a >= threshold
  // comparison against warningThresholdPercent -- that comparison exists
  // exactly once, inside quota-status.ts, not here.
  assert.equal(/warningThresholdPercent\s*>=|>=\s*.*warningThresholdPercent/.test(SOURCE), false);
});

test("delegation: a WARNING outcome for a realistic fixture matches computeRadarAiQuotaStatus's own documented threshold semantics (>= is inclusive)", async () => {
  policyFixture = { status: "ok", policy: { enabled: true, dailyRequestLimit: 100, dailyTokenLimit: null, warningThresholdPercent: 50 } };
  counterFixture = { throws: false, counter: counterRow(50, 0) };
  const atThreshold = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(atThreshold.quotaStatus, "WARNING");

  counterFixture = { throws: false, counter: counterRow(49, 0) };
  const belowThreshold = await getRadarAiQuotaGovernanceSnapshot();
  assert.equal(belowThreshold.quotaStatus, "NORMAL");
});
