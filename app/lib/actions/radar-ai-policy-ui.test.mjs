// RADAR INTELLIGENCE V2.1 — Phase C — lib/actions/radar-ai-policy-ui.ts tests.
//
// @/lib/rbac/require-staff-member and @/lib/actions/radar-ai-policy are
// mocked at the module boundary -- this suite touches no live Postgres
// connection, no Next.js runtime, and dispatches zero provider calls.
// next/cache's revalidatePath is a real no-op outside a request scope, so
// it is left un-mocked (same convention as workforce-admin-ui.ts callers).
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-ai-policy-ui.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

/** @type {string[]} */
let revalidateCalls = [];
mock.module("next/cache", { namedExports: { revalidatePath: (p) => revalidateCalls.push(p) } });

/** @type {string} the role/permission-check outcome requireStaffMember() should return; "DENY" throws NEXT_REDIRECT instead. */
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

const DEFAULT_POLICY = {
  mode: "AUTO",
  defaultProvider: "anthropic",
  fallbackOrder: ["anthropic", "openai"],
  enabledProviders: ["anthropic", "openai"],
  userSelectableProviders: [],
  allowUserSelection: false,
  fallbackEnabled: true,
};

let getCalls = 0;
let updateCalls = [];
let resetCalls = 0;
/** @type {{ throw?: Error }} */
let updateBehavior = {};
/** @type {{ throw?: Error }} */
let resetBehavior = {};

mock.module("@/lib/actions/radar-ai-policy", {
  namedExports: {
    getRadarAiProviderPolicy: async () => {
      getCalls += 1;
      return { policy: DEFAULT_POLICY, updatedAt: null };
    },
    updateRadarAiProviderPolicy: async (candidate) => {
      updateCalls.push(candidate);
      if (updateBehavior.throw) throw updateBehavior.throw;
      return { ...DEFAULT_POLICY, defaultProvider: "openai" };
    },
    resetRadarAiProviderPolicy: async () => {
      resetCalls += 1;
      if (resetBehavior.throw) throw resetBehavior.throw;
      return DEFAULT_POLICY;
    },
  },
});

const { getRadarAiProviderPolicyPageData, saveRadarAiProviderPolicyAction, resetRadarAiProviderPolicyAction } = await import(
  "./radar-ai-policy-ui.ts"
);

function reset() {
  permissionMode = "OWNER";
  permissionCalls = [];
  getCalls = 0;
  updateCalls = [];
  resetCalls = 0;
  updateBehavior = {};
  resetBehavior = {};
  revalidateCalls = [];
}

test.beforeEach(reset);

// ---- permission gate: RADAR_AI_POLICY_MANAGE, first thing called ----

test("getRadarAiProviderPolicyPageData: requires RADAR_AI_POLICY_MANAGE, delegates to the Phase B read", async () => {
  const result = await getRadarAiProviderPolicyPageData();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
  assert.equal(getCalls, 1);
  assert.deepEqual(result.policy, DEFAULT_POLICY);
});

test("saveRadarAiProviderPolicyAction: requires RADAR_AI_POLICY_MANAGE as the FIRST thing, before any mutation", async () => {
  await saveRadarAiProviderPolicyAction({ ...DEFAULT_POLICY });
  assert.equal(permissionCalls[0], "RADAR_AI_POLICY_MANAGE");
  assert.equal(updateCalls.length, 1);
});

test("resetRadarAiProviderPolicyAction: requires RADAR_AI_POLICY_MANAGE as the FIRST thing, before any mutation", async () => {
  await resetRadarAiProviderPolicyAction();
  assert.equal(permissionCalls[0], "RADAR_AI_POLICY_MANAGE");
  assert.equal(resetCalls, 1);
});

// ---- denied roles ----

for (const role of ["ADMIN", "MANAGER", "EMPLOYEE"]) {
  test(`${role} is denied before any read (getRadarAiProviderPolicyPageData)`, async () => {
    permissionMode = "DENY";
    await assert.rejects(() => getRadarAiProviderPolicyPageData(), /NEXT_REDIRECT/);
    assert.equal(getCalls, 0);
  });

  test(`${role} is denied before any save (saveRadarAiProviderPolicyAction) -- zero mutation`, async () => {
    permissionMode = "DENY";
    await assert.rejects(() => saveRadarAiProviderPolicyAction({ ...DEFAULT_POLICY }), /NEXT_REDIRECT/);
    assert.equal(updateCalls.length, 0);
  });

  test(`${role} is denied before any reset (resetRadarAiProviderPolicyAction) -- zero mutation`, async () => {
    permissionMode = "DENY";
    await assert.rejects(() => resetRadarAiProviderPolicyAction(), /NEXT_REDIRECT/);
    assert.equal(resetCalls, 0);
  });
}

// ---- success path: policy returned, no raw server error ----

test("saveRadarAiProviderPolicyAction: success -> { ok: true, policy } with the saved policy, no error code", async () => {
  const result = await saveRadarAiProviderPolicyAction({ ...DEFAULT_POLICY, defaultProvider: "openai" });
  assert.deepEqual(result, { ok: true, policy: { ...DEFAULT_POLICY, defaultProvider: "openai" } });
});

test("resetRadarAiProviderPolicyAction: success -> { ok: true, policy: DEFAULT_PROVIDER_POLICY }", async () => {
  const result = await resetRadarAiProviderPolicyAction();
  assert.deepEqual(result, { ok: true, policy: DEFAULT_POLICY });
});

test("a successful save/reset revalidates the settings page path; a validation failure does not", async () => {
  await saveRadarAiProviderPolicyAction({ ...DEFAULT_POLICY });
  assert.deepEqual(revalidateCalls, ["/admin/owner/ai-providers"]);

  revalidateCalls = [];
  await resetRadarAiProviderPolicyAction();
  assert.deepEqual(revalidateCalls, ["/admin/owner/ai-providers"]);

  revalidateCalls = [];
  updateBehavior = { throw: new Error("invalid provider policy: bad") };
  await saveRadarAiProviderPolicyAction({ enabledProviders: ["gemini"] });
  assert.deepEqual(revalidateCalls, [], "a rejected candidate must not revalidate the page");
});

// ---- validation failure -> stable code, never a raw server string ----

test("saveRadarAiProviderPolicyAction: a Phase B validation rejection maps to { ok: false, error: 'INVALID_POLICY' } -- never the raw message", async () => {
  updateBehavior = { throw: new Error("invalid provider policy: enabledProviders contains an unrecognized/unsupported provider id") };
  const result = await saveRadarAiProviderPolicyAction({ enabledProviders: ["gemini"] });
  assert.deepEqual(result, { ok: false, error: "INVALID_POLICY" });
});

test("saveRadarAiProviderPolicyAction: an infra/config error (not the validation prefix) propagates untouched, never silently mapped", async () => {
  updateBehavior = { throw: new Error("internal workspace is not configured") };
  await assert.rejects(() => saveRadarAiProviderPolicyAction({ ...DEFAULT_POLICY }), /internal workspace is not configured/);
});

test("resetRadarAiProviderPolicyAction: an infra/config error propagates untouched", async () => {
  resetBehavior = { throw: new Error("internal workspace is not configured") };
  await assert.rejects(() => resetRadarAiProviderPolicyAction(), /internal workspace is not configured/);
});

test("saveRadarAiProviderPolicyAction: a NEXT_REDIRECT thrown mid-mutation is rethrown untouched (unstable_rethrow), never mapped to a business code", async () => {
  const redirectErr = new Error("NEXT_REDIRECT");
  redirectErr.digest = "NEXT_REDIRECT;replace;/admin;307;";
  updateBehavior = { throw: redirectErr };
  await assert.rejects(() => saveRadarAiProviderPolicyAction({ ...DEFAULT_POLICY }), /NEXT_REDIRECT/);
});
