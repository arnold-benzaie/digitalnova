// RADAR INTELLIGENCE V2.1 — Phase G3B — lib/actions/radar-ai-token-governance.ts tests.
//
// @/lib/rbac/require-staff-member and @/lib/radar-intelligence/token-accounting
// are mocked at the module boundary -- this suite touches no live
// Postgres connection, no Next.js runtime, and dispatches zero provider
// calls.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-ai-token-governance.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

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

const TOTALS_FIXTURE = { inputTokens: 519, outputTokens: 187, totalTokens: 706 };
const BY_PROVIDER_FIXTURE = [{ providerId: "anthropic", inputTokens: 519, outputTokens: 187, totalTokens: 706 }];
const BY_MODEL_FIXTURE = [{ providerId: "anthropic", modelId: "claude-sonnet-4-5", inputTokens: 519, outputTokens: 187, totalTokens: 706 }];
const BY_SELECTION_MODE_FIXTURE = [{ selectionMode: "automatic", inputTokens: 519, outputTokens: 187, totalTokens: 706 }];

/** @type {Array<{ fn: string; window: unknown }>} */
let g3aCalls = [];
/** @type {{ throwOn?: string }} */
let g3aBehavior = {};

function recordCall(fn, window) {
  g3aCalls.push({ fn, window });
  if (g3aBehavior.throwOn === fn) throw new Error(`simulated DB failure in ${fn}`);
}

mock.module("@/lib/radar-intelligence/token-accounting", {
  namedExports: {
    getGlobalTokenUsage: async (window) => {
      recordCall("getGlobalTokenUsage", window);
      return TOTALS_FIXTURE;
    },
    getSuccessfulAdvisoryCount: async (window) => {
      recordCall("getSuccessfulAdvisoryCount", window);
      return 42;
    },
    getSuccessfulFallbackAdvisoryCount: async (window) => {
      recordCall("getSuccessfulFallbackAdvisoryCount", window);
      return 3;
    },
    getTokenUsageByProvider: async (window) => {
      recordCall("getTokenUsageByProvider", window);
      return BY_PROVIDER_FIXTURE;
    },
    getTokenUsageByModel: async (window) => {
      recordCall("getTokenUsageByModel", window);
      return BY_MODEL_FIXTURE;
    },
    getTokenUsageBySelectionMode: async (window) => {
      recordCall("getTokenUsageBySelectionMode", window);
      return BY_SELECTION_MODE_FIXTURE;
    },
  },
});

const { getRadarAiTokenGovernanceSnapshot } = await import("./radar-ai-token-governance.ts");

test.beforeEach(() => {
  permissionMode = "OWNER";
  permissionCalls = [];
  g3aCalls = [];
  g3aBehavior = {};
});

// ---- authorization ----

test("OWNER is allowed", async () => {
  const snapshot = await getRadarAiTokenGovernanceSnapshot("today");
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
  assert.equal(snapshot.window, "today");
});

test("a denied caller (ADMIN/MANAGER/EMPLOYEE bucket) is rejected before any G3A call", async () => {
  permissionMode = "DENY";
  await assert.rejects(() => getRadarAiTokenGovernanceSnapshot("today"), (err) => err.digest === "NEXT_REDIRECT;replace;/admin;307;");
  assert.equal(g3aCalls.length, 0);
});

test("never uses SYSTEM_ADMIN or ANALYTICS_TEAM_VIEW -- only RADAR_AI_POLICY_MANAGE", async () => {
  await getRadarAiTokenGovernanceSnapshot("today");
  assert.ok(!permissionCalls.includes("SYSTEM_ADMIN"));
  assert.ok(!permissionCalls.includes("ANALYTICS_TEAM_VIEW"));
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
});

// ---- window validation ----

test("'today' is accepted", async () => {
  const snapshot = await getRadarAiTokenGovernanceSnapshot("today");
  assert.equal(snapshot.window, "today");
});

test("'7d' is accepted", async () => {
  const snapshot = await getRadarAiTokenGovernanceSnapshot("7d");
  assert.equal(snapshot.window, "7d");
});

test("'30d' is accepted", async () => {
  const snapshot = await getRadarAiTokenGovernanceSnapshot("30d");
  assert.equal(snapshot.window, "30d");
});

test("an invalid window string is rejected -- never silently coerced to 'today'", async () => {
  await assert.rejects(() => getRadarAiTokenGovernanceSnapshot("this-year"), /invalid token governance window/);
});

test("a non-string window (number/object/null/undefined) is rejected", async () => {
  for (const bad of [42, {}, null, undefined, ["today"]]) {
    await assert.rejects(() => getRadarAiTokenGovernanceSnapshot(bad), /invalid token governance window/);
  }
});

test("an invalid window makes ZERO G3A calls -- rejection happens before any aggregation", async () => {
  await assert.rejects(() => getRadarAiTokenGovernanceSnapshot("forged"));
  assert.equal(g3aCalls.length, 0);
});

test("a rejected window still checks authorization FIRST -- a denied caller never even reaches window validation errors", async () => {
  permissionMode = "DENY";
  await assert.rejects(() => getRadarAiTokenGovernanceSnapshot("forged"), (err) => err.digest === "NEXT_REDIRECT;replace;/admin;307;");
});

// ---- G3A call wiring ----

test("all six G3A helpers are called with the SAME validated window", async () => {
  await getRadarAiTokenGovernanceSnapshot("7d");
  const fns = g3aCalls.map((c) => c.fn).sort();
  assert.deepEqual(
    fns,
    ["getGlobalTokenUsage", "getSuccessfulAdvisoryCount", "getSuccessfulFallbackAdvisoryCount", "getTokenUsageByModel", "getTokenUsageByProvider", "getTokenUsageBySelectionMode"].sort(),
  );
  for (const call of g3aCalls) assert.equal(call.window, "7d");
});

test("never accepts a provider id, model id, dimension, or SQL fragment from the caller -- window is the ONLY parameter", () => {
  assert.equal(getRadarAiTokenGovernanceSnapshot.length, 1);
});

// ---- snapshot shape ----

test("the returned snapshot shape matches the approved contract exactly", async () => {
  const snapshot = await getRadarAiTokenGovernanceSnapshot("today");
  assert.deepEqual(
    Object.keys(snapshot).sort(),
    ["window", "totals", "successfulAdvisories", "successfulFallbackAdvisories", "byProvider", "byModel", "bySelectionMode"].sort(),
  );
  assert.deepEqual(Object.keys(snapshot.totals).sort(), ["inputTokens", "outputTokens", "totalTokens"].sort());
});

test("totals/counts/breakdowns are forwarded verbatim from G3A -- never recomputed or reinterpreted", async () => {
  const snapshot = await getRadarAiTokenGovernanceSnapshot("today");
  assert.deepEqual(snapshot.totals, TOTALS_FIXTURE);
  assert.equal(snapshot.successfulAdvisories, 42);
  assert.equal(snapshot.successfulFallbackAdvisories, 3);
  assert.deepEqual(snapshot.byProvider, BY_PROVIDER_FIXTURE);
  assert.deepEqual(snapshot.byModel, BY_MODEL_FIXTURE);
  assert.deepEqual(snapshot.bySelectionMode, BY_SELECTION_MODE_FIXTURE);
});

test("no raw telemetry row, actorUserId, clientId, prompt, advisory, providerRequestId, or secret field anywhere in the snapshot", async () => {
  const snapshot = await getRadarAiTokenGovernanceSnapshot("today");
  const serialized = JSON.stringify(snapshot);
  assert.equal(/actorUserId|clientId|\bprompt\b|advisoryText|providerRequestId|apiKey|Authorization|Bearer|password|secret|credential/i.test(serialized), false);
});

test("no cost/price/currency field anywhere in the snapshot", async () => {
  const snapshot = await getRadarAiTokenGovernanceSnapshot("today");
  const serialized = JSON.stringify(snapshot);
  assert.equal(/estimatedCost|\bprice\b|pricing|USD|EUR|CAD|\bcost\b|currency/i.test(serialized), false);
});

// ---- G3A error propagation ----

test("a G3A error propagates -- this action does not swallow or fabricate a fallback snapshot itself (the PAGE is responsible for a safe error state)", async () => {
  g3aBehavior = { throwOn: "getGlobalTokenUsage" };
  await assert.rejects(() => getRadarAiTokenGovernanceSnapshot("today"), /simulated DB failure/);
});
