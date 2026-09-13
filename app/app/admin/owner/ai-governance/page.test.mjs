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

// PHASE G4C-3 — the "Quota actuel" section's own independent read.
let quotaGovernanceCalls = 0;
/** @type {{ throw?: boolean; snapshot?: object }} */
let quotaGovernanceBehavior = {};

const NORMAL_SNAPSHOT_FIXTURE = {
  quotaStatus: "NORMAL",
  enabled: true,
  dailyRequestLimit: 500,
  dailyTokenLimit: 200_000,
  warningThresholdPercent: 80,
  requestCount: 10,
  tokenCount: 1_000,
  requestRemaining: 490,
  tokenRemaining: 199_000,
  requestUsagePercent: 2,
  tokenUsagePercent: 0.5,
};

mock.module("@/lib/actions/radar-ai-quota-governance", {
  namedExports: {
    getRadarAiQuotaGovernanceSnapshot: async () => {
      quotaGovernanceCalls += 1;
      if (quotaGovernanceBehavior.throw) throw new Error("simulated DB failure -- must never reach the rendered page");
      return quotaGovernanceBehavior.snapshot ?? { ...NORMAL_SNAPSHOT_FIXTURE };
    },
  },
});

const { default: AiGovernanceOwnerPage } = await import("./page.tsx");
const AiQuotaStatusPanelSource = (await import("node:fs")).readFileSync(
  (await import("node:url")).fileURLToPath(new URL("../../../../components/owner/ai-quota-status-panel.tsx", import.meta.url)),
  "utf8",
);

function reset() {
  permissionCalls = [];
  denyMode = false;
  snapshotCalls = [];
  snapshotBehavior = {};
  quotaPolicyCalls = 0;
  quotaPolicyBehavior = {};
  quotaGovernanceCalls = 0;
  quotaGovernanceBehavior = {};
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
  assert.equal(quotaGovernanceCalls, 0, "a denied caller never reaches the G4C-3 quota governance snapshot read either");
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

// =====================================================================
// RADAR INTELLIGENCE V2.1 — Phase G4C-3 — the embedded "Quota actuel"
// section (AiQuotaStatusPanel), fed by getRadarAiQuotaGovernanceSnapshot()
// (G4C-2), rendered independently of both the policy-configuration
// section (G4A) and the historical usage report (G3B).
// =====================================================================

function stringifyElement(el) {
  return JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
}

// 1. OWNER page loads snapshot
test("G4C-3: OWNER page loads the quota governance snapshot exactly once", async () => {
  reset();
  await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.equal(quotaGovernanceCalls, 1);
});

test("G4C-3: the snapshot read is independent -- a G3B snapshot failure never prevents it, and vice versa", async () => {
  reset();
  snapshotBehavior = { throw: true };
  await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.equal(quotaGovernanceCalls, 1, "the G4C-3 read must still happen even when the G3B token-usage read fails");

  reset();
  quotaGovernanceBehavior = { throw: true };
  await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.equal(snapshotCalls.length, 1, "the G3B read must still happen even when the G4C-3 quota governance read fails");
});

// 2. quota normal
test("G4C-3: NORMAL status renders the request/token detail verbatim from the snapshot", async () => {
  reset();
  quotaGovernanceBehavior = { snapshot: { ...NORMAL_SNAPSHOT_FIXTURE } };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"requestCount":10'));
  assert.ok(s.includes('"tokenCount":1000'));
  assert.ok(s.includes('"requestRemaining":490'));
});

// 3. quota warning
test("G4C-3: WARNING status snapshot is passed through to the panel verbatim", async () => {
  reset();
  quotaGovernanceBehavior = {
    snapshot: {
      quotaStatus: "WARNING",
      enabled: true,
      dailyRequestLimit: 100,
      dailyTokenLimit: null,
      warningThresholdPercent: 80,
      requestCount: 85,
      tokenCount: 0,
      requestRemaining: 15,
      tokenRemaining: null,
      requestUsagePercent: 85,
      tokenUsagePercent: null,
    },
  };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"quotaStatus":"WARNING"'));
  assert.ok(s.includes('"requestUsagePercent":85'));
});

// 4. quota limited
test("G4C-3: LIMITED status snapshot is passed through to the panel verbatim", async () => {
  reset();
  quotaGovernanceBehavior = {
    snapshot: {
      quotaStatus: "LIMITED",
      enabled: true,
      dailyRequestLimit: 100,
      dailyTokenLimit: null,
      warningThresholdPercent: 80,
      requestCount: 100,
      tokenCount: 0,
      requestRemaining: 0,
      tokenRemaining: null,
      requestUsagePercent: 100,
      tokenUsagePercent: null,
    },
  };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"quotaStatus":"LIMITED"'));
  assert.ok(s.includes('"requestRemaining":0'));
});

// 5. quota disabled
test("G4C-3: DISABLED status renders the minimal shape (no usage fields fabricated)", async () => {
  reset();
  quotaGovernanceBehavior = {
    snapshot: { quotaStatus: "DISABLED", enabled: false, dailyRequestLimit: 10, dailyTokenLimit: null, warningThresholdPercent: 80 },
  };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"quotaStatus":"DISABLED"'));
  assert.equal(s.includes('"requestCount"'), false, "DISABLED must never carry a fabricated usage count");
  assert.equal(s.includes('"requestRemaining"'), false);
});

// 6. quota unavailable
test("G4C-3: UNAVAILABLE status renders the safe unavailability message, no value invented, never a fabricated 0", async () => {
  reset();
  quotaGovernanceBehavior = { snapshot: { quotaStatus: "UNAVAILABLE" } };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"quotaStatus":"UNAVAILABLE"'));
  assert.equal(/"requestCount":0|"tokenCount":0|"requestRemaining":0|"tokenRemaining":0/.test(s), false, "no fabricated zero anywhere for an UNAVAILABLE snapshot");
});

test("G4C-3: a thrown quota-governance read (defense-in-depth path) renders the same safe unavailability message, never throws to the caller", async () => {
  reset();
  quotaGovernanceBehavior = { throw: true };
  await assert.doesNotReject(() => AiGovernanceOwnerPage({ searchParams: searchParams() }));
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.equal(s.includes('"quotaStatus"'), false, "on a caught exception, the panel itself is never rendered -- only the fixed error message");
});

// 7. unlimited request
test("G4C-3: a null dailyRequestLimit is forwarded as null, never coerced to a number or a fake 'unlimited' sentinel value", async () => {
  reset();
  quotaGovernanceBehavior = {
    snapshot: { ...NORMAL_SNAPSHOT_FIXTURE, dailyRequestLimit: null, requestRemaining: null, requestUsagePercent: null },
  };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"dailyRequestLimit":null'));
  assert.ok(s.includes('"requestRemaining":null'));
});

// 8. unlimited token
test("G4C-3: a null dailyTokenLimit is forwarded as null", async () => {
  reset();
  quotaGovernanceBehavior = {
    snapshot: { ...NORMAL_SNAPSHOT_FIXTURE, dailyTokenLimit: null, tokenRemaining: null, tokenUsagePercent: null },
  };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"dailyTokenLimit":null'));
  assert.ok(s.includes('"tokenRemaining":null'));
});

// 9. mixed request/token limits
test("G4C-3: mixed configuration (request limited, token unlimited) is forwarded verbatim", async () => {
  reset();
  quotaGovernanceBehavior = {
    snapshot: {
      quotaStatus: "LIMITED",
      enabled: true,
      dailyRequestLimit: 10,
      dailyTokenLimit: null,
      warningThresholdPercent: 80,
      requestCount: 10,
      tokenCount: 999_999,
      requestRemaining: 0,
      tokenRemaining: null,
      requestUsagePercent: 100,
      tokenUsagePercent: null,
    },
  };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"dailyRequestLimit":10'));
  assert.ok(s.includes('"dailyTokenLimit":null'));
  assert.ok(s.includes('"tokenCount":999999'));
});

// 10. remaining values displayed
test("G4C-3: requestRemaining and tokenRemaining are both forwarded verbatim, never recomputed by the page", async () => {
  reset();
  quotaGovernanceBehavior = { snapshot: { ...NORMAL_SNAPSHOT_FIXTURE, requestRemaining: 123, tokenRemaining: 45_678 } };
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"requestRemaining":123'));
  assert.ok(s.includes('"tokenRemaining":45678'));
});

// 11. G3B historical report remains present
test("G4C-3: the G3B historical token-usage report still renders in full alongside the new G4C-3 section", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes('"inputTokens":519'), "G3B totals must still be present");
  assert.ok(s.includes('"byProvider"'));
  assert.ok(s.includes('"bySelectionMode"'));
});

// 12. G3B and G4C remain visually/data-wise distinct
test("G4C-3: the G3B history section heading and the G4C-3 quota section heading are both present, distinct, non-empty strings", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  assert.ok(s.includes("Historique d'utilisation IA"), "G3B section must be clearly labelled as historical");
  assert.ok(s.includes("Quota actuel"), "G4C-3 section must be clearly labelled as the current quota");
});

test("G4C-3: the G4C-3 snapshot's own fields (quotaStatus/requestCount/tokenCount) never appear inside the G3B TokenGovernanceSnapshot object, and vice versa -- the two are never merged into one payload", async () => {
  reset();
  const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
  const s = stringifyElement(el);
  const tokenGovernanceMatch = s.match(/"totals":\{[^}]*\}/);
  assert.ok(tokenGovernanceMatch, "expected the G3B totals object to be present");
  assert.equal(tokenGovernanceMatch[0].includes("quotaStatus"), false, "G4C-3's quotaStatus must never leak into the G3B totals object");
});

// 13. no client-facing surface introduced
test("G4C-3: AiQuotaStatusPanel is a plain server-renderable component (no 'use client'), so no separate, less-gated client entry point exists for this data", () => {
  assert.equal(/^["']use client["']/m.test(AiQuotaStatusPanelSource), false);
});

test("G4C-3: the page still has exactly ONE authorization call site -- no second, parallel, less-gated path was introduced for the new section", async () => {
  reset();
  await AiGovernanceOwnerPage({ searchParams: searchParams() });
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"], "still exactly one authorization check, still exactly RADAR_AI_POLICY_MANAGE");
});

// 14. non-OWNER remains denied
test("G4C-3: a denied caller (ADMIN/MANAGER/EMPLOYEE) never reaches the quota governance read, exactly like the other two sections", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => AiGovernanceOwnerPage({ searchParams: searchParams() }), /NEXT_REDIRECT/);
  assert.equal(quotaGovernanceCalls, 0);
});

test("G4C-3: no secret-shaped value appears anywhere in the rendered element tree, across every quotaStatus branch", async () => {
  for (const snapshot of [
    { quotaStatus: "UNAVAILABLE" },
    { quotaStatus: "DISABLED", enabled: false, dailyRequestLimit: null, dailyTokenLimit: null, warningThresholdPercent: 80 },
    { ...NORMAL_SNAPSHOT_FIXTURE },
  ]) {
    reset();
    quotaGovernanceBehavior = { snapshot };
    const el = await AiGovernanceOwnerPage({ searchParams: searchParams() });
    const s = stringifyElement(el);
    assert.equal(/apiKey|sk-ant-|sk-proj-|DATABASE_URL|Authorization|Bearer|credential/i.test(s), false);
  }
});
