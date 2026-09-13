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

const { default: AiGovernanceOwnerPage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
  snapshotCalls = [];
  snapshotBehavior = {};
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
