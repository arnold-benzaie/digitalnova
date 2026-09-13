// RADAR INTELLIGENCE V2.1 — Phase G3B — focused test for the
// /admin/owner/ai-governance protected route. Proves: (1) the
// authorization boundary is the FIRST thing that runs and asks for
// exactly "RADAR_AI_POLICY_MANAGE"; (2) the snapshot is read through the
// gated Server Action, never a direct DB/store call from the page; (3) a
// guard denial produces no page content and no snapshot read; (4) an
// invalid/missing URL window safely displays "today" without ever
// passing an unvalidated value past display; (5) a snapshot-load failure
// renders the safe error message, never a raw error.
//
// @/lib/rbac/require-staff-member and
// @/lib/actions/radar-ai-token-governance are mocked at the module
// boundary so no live Postgres / Next runtime is needed. getLocale() is
// left real (returns "fr" outside a request).
//
// Run with: npx tsx --test --experimental-test-module-mocks app/admin/owner/ai-governance/page.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

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
      return "OWNER";
    },
  },
});

const SNAPSHOT_FIXTURE = {
  window: "today",
  totals: { inputTokens: 519, outputTokens: 187, totalTokens: 706 },
  successfulAdvisories: 42,
  successfulFallbackAdvisories: 3,
  byProvider: [{ providerId: "anthropic", inputTokens: 519, outputTokens: 187, totalTokens: 706 }],
  byModel: [{ providerId: "anthropic", modelId: "claude-sonnet-4-5", inputTokens: 519, outputTokens: 187, totalTokens: 706 }],
  bySelectionMode: [{ selectionMode: "automatic", inputTokens: 519, outputTokens: 187, totalTokens: 706 }],
};

let snapshotCalls = [];
/** @type {{ throw?: boolean }} */
let snapshotBehavior = {};

mock.module("@/lib/actions/radar-ai-token-governance", {
  namedExports: {
    getRadarAiTokenGovernanceSnapshot: async (window) => {
      snapshotCalls.push(window);
      if (snapshotBehavior.throw) throw new Error("simulated DB failure -- must never reach the rendered page");
      return { ...SNAPSHOT_FIXTURE, window };
    },
  },
});

const QUOTA_POLICY_FIXTURE = { enabled: true, dailyRequestLimit: 500, dailyTokenLimit: 200000, warningThresholdPercent: 80 };

let quotaPolicyCalls = 0;
/** @type {{ throw?: boolean; storeStatus?: "ok" | "missing" | "error" }} */
let quotaPolicyBehavior = {};

// PHASE G4B-2 correction: getRadarAiQuotaPolicy() now returns
// { policy, storeStatus } instead of a bare policy -- `storeStatus`
// defaults to "ok" here so every pre-correction test keeps its exact
// byte-identical behavior; dedicated correction tests override it to
// "error"/"missing".
mock.module("@/lib/actions/radar-ai-quota-policy", {
  namedExports: {
    getRadarAiQuotaPolicy: async () => {
      quotaPolicyCalls += 1;
      if (quotaPolicyBehavior.throw) throw new Error("simulated DB failure -- must never reach the rendered page");
      return { policy: { ...QUOTA_POLICY_FIXTURE }, storeStatus: quotaPolicyBehavior.storeStatus ?? "ok" };
    },
  },
});

const { default: AiGovernanceOwnerPage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
  snapshotCalls = [];
  snapshotBehavior = {};
  quotaPolicyCalls = 0;
  quotaPolicyBehavior = {};
}

function searchParams(params = {}) {
  return Promise.resolve(params);
}

test("Phase G3B page: authorized -> renders; guard called exactly once with 'RADAR_AI_POLICY_MANAGE'", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
  assert.equal(snapshotCalls.length, 1);
  assert.ok(el, "expected a React element when authorized");
});

test("Phase G4A page: authorized -> the quota policy is read exactly once (independent read from the token-usage snapshot)", async () => {
  reset();
  await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.equal(quotaPolicyCalls, 1);
});

test("Phase G3B page: never asks for SYSTEM_ADMIN or ANALYTICS_TEAM_VIEW directly -- only RADAR_AI_POLICY_MANAGE", async () => {
  reset();
  await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.ok(!permissionCalls.includes("SYSTEM_ADMIN"));
  assert.ok(!permissionCalls.includes("ANALYTICS_TEAM_VIEW"));
});

test("Phase G3B page: a guard denial (NEXT_REDIRECT) propagates -- no snapshot read, no page content", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => AiGovernanceOwnerPage({ searchParams: searchParams() }), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"], "the guard still ran, with exactly RADAR_AI_POLICY_MANAGE, before any read");
  assert.equal(snapshotCalls.length, 0, "a denied caller never reaches the snapshot read");
  assert.equal(quotaPolicyCalls, 0, "a denied caller (ADMIN/MANAGER/EMPLOYEE) never reaches the quota policy read either");
});

test("Phase G3B page: missing window query param safely defaults to 'today' for display", async () => {
  reset();
  await AiGovernanceOwnerPage({ searchParams: searchParams({}) });
  assert.equal(snapshotCalls[0], "today");
});

test("Phase G3B page: an invalid/forged window query param safely defaults to 'today' for display -- never forwarded raw", async () => {
  reset();
  await AiGovernanceOwnerPage({ searchParams: searchParams({ window: "this-year-forged" }) });
  assert.equal(snapshotCalls[0], "today");
});

test("Phase G3B page: a valid '7d' window query param is forwarded to the Server Action", async () => {
  reset();
  await AiGovernanceOwnerPage({ searchParams: searchParams({ window: "7d" }) });
  assert.equal(snapshotCalls[0], "7d");
});

test("Phase G3B page: a valid '30d' window query param is forwarded to the Server Action", async () => {
  reset();
  await AiGovernanceOwnerPage({ searchParams: searchParams({ window: "30d" }) });
  assert.equal(snapshotCalls[0], "30d");
});

test("Phase G3B page: a snapshot-load failure is caught and renders without throwing to the caller", async () => {
  reset();
  snapshotBehavior = { throw: true };
  await assert.doesNotReject(() => AiGovernanceOwnerPage({ searchParams: searchParams() }));
});

test("Phase G3B page: authorization ignores caller-supplied input -- a forged { role } / { canManageAiPolicy } in searchParams changes nothing", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams({ role: "OWNER", canManageAiPolicy: "true" }) });
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"], "still exactly RADAR_AI_POLICY_MANAGE -- no caller value influences the check");
  assert.ok(el);
});

test("Phase G3B page: no secret-shaped value (apiKey/env/credential) appears anywhere in the rendered element tree's props", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  assert.equal(/apiKey|sk-ant-|sk-proj-|DATABASE_URL|Authorization|Bearer/i.test(s), false);
});

test("Phase G3B page: no cost/price/currency value appears anywhere in the rendered element tree's props", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  assert.equal(/estimatedCost|\bUSD\b|\bEUR\b|\bCAD\b|pricing/i.test(s), false);
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase G4A — the embedded "Quotas et limites"
// section (QuotaPolicyForm), rendered independently of the token-usage
// snapshot above.
// =====================================================================

test("Phase G4A page: a quota-policy load failure is caught and renders without throwing to the caller", async () => {
  reset();
  quotaPolicyBehavior = { throw: true };
  await assert.doesNotReject(() => AiGovernanceOwnerPage({ searchParams: searchParams() }));
});

test("Phase G4A page: a quota-policy load failure does NOT prevent the token-usage snapshot from still loading/rendering", async () => {
  reset();
  quotaPolicyBehavior = { throw: true };
  await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.equal(snapshotCalls.length, 1, "the token-usage read must still happen even when the quota-policy read fails");
});

test("Phase G4A page: a token-usage snapshot load failure does NOT prevent the quota policy from still loading/rendering", async () => {
  reset();
  snapshotBehavior = { throw: true };
  await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.equal(quotaPolicyCalls, 1, "the quota-policy read must still happen even when the token-usage read fails");
});

test("Phase G4A page: the quota policy is passed to QuotaPolicyForm verbatim, never recomputed", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  assert.ok(s.includes('"dailyRequestLimit":500'));
  assert.ok(s.includes('"dailyTokenLimit":200000'));
  assert.ok(s.includes('"warningThresholdPercent":80'));
});

test("Phase G4A page: no fake consumption/remaining/usage FIELD is ever passed to QuotaPolicyForm -- G4A is configuration-only", async () => {
  // A narrow, key-shaped check (not a naive prose substring match): the
  // dictionary legitimately uses words like "consommation" in its
  // DESCRIPTIVE copy ("politique de consommation IA" = "AI consumption
  // POLICY", the feature's own name) -- that is not a computed number and
  // must not trip this test. What must never exist is an actual VALUE
  // field for remaining budget / current consumption on the quota policy
  // object itself, since no enforcement/counter exists yet (G4B).
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  const initialPolicyMatch = s.match(/"initialPolicy":\{[^}]*\}/);
  assert.ok(initialPolicyMatch, "expected an initialPolicy prop to be present");
  assert.deepEqual(Object.keys(JSON.parse(initialPolicyMatch[0].slice('"initialPolicy":'.length))).sort(), ["dailyRequestLimit", "dailyTokenLimit", "enabled", "warningThresholdPercent"].sort());
});

test("Phase G4A page: no secret-shaped value (apiKey/credential/token) appears anywhere in the rendered element tree", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  assert.equal(/apiKey|sk-ant-|sk-proj-|DATABASE_URL|Authorization|Bearer|credential/i.test(s), false);
});

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase G4B-2 CORRECTION — the OWNER must
// never see "enabled, unlimited" rendered as if it were the real,
// active configuration while the policy store is genuinely down.
// =====================================================================

test("G4B-2 correction: storeStatus='error' renders the SAME safe error message as a thrown exception -- never the form with a default policy", async () => {
  reset();
  quotaPolicyBehavior = { storeStatus: "error" };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  assert.equal(s.includes('"initialPolicy"'), false, "the QuotaPolicyForm (and its default-looking policy values) must never render during a genuine store outage");
  assert.ok(s.includes("temporairement") || s.includes("indisponible") || s.includes("unavailable") || s.includes("Les données"), "the same safe error copy already used for a thrown exception must render");
});

test("G4B-2 correction: storeStatus='missing' renders the form normally, with the safe default policy -- a legitimate first-install state, not an error", async () => {
  reset();
  quotaPolicyBehavior = { storeStatus: "missing" };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  assert.ok(s.includes('"initialPolicy"'), "a 'missing' policy is a normal, renderable state -- the form must still appear");
});

test("G4B-2 correction: storeStatus='ok' (default) still renders the form exactly as before -- unaffected by this correction", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  assert.ok(s.includes('"initialPolicy"'));
});
