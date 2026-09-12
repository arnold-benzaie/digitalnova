// RADAR INTELLIGENCE V2.1 — Phase E — lib/actions/radar-ai-provider-ops-ui.ts tests.
//
// @/lib/rbac/require-staff-member and @/lib/actions/radar-ai-provider-ops
// are mocked at the module boundary -- no live Postgres, no Next.js
// runtime, zero provider calls. next/cache's revalidatePath is a real
// no-op outside a request scope (same convention as radar-ai-policy-ui.test.mjs).
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-ai-provider-ops-ui.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

/** @type {string[]} */
let revalidateCalls = [];
mock.module("next/cache", { namedExports: { revalidatePath: (p) => revalidateCalls.push(p) } });

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

const STATUS_FIXTURE = [
  { providerId: "anthropic", credentialStatus: "configured", enabled: true, model: "claude-sonnet-4-5", modelIsOverridden: false, operationalState: "ready" },
  { providerId: "openai", credentialStatus: "not_configured", enabled: false, model: "gpt-4o-mini", modelIsOverridden: false, operationalState: "unknown" },
];
const CATALOG_FIXTURE = {
  anthropic: [{ providerId: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", status: "active" }],
  openai: [{ providerId: "openai", id: "gpt-4o-mini", label: "GPT-4o mini", status: "active" }],
};

let statusCalls = 0;
let catalogCalls = 0;
let updateCalls = [];
/** @type {{ throw?: Error }} */
let updateBehavior = {};

mock.module("@/lib/actions/radar-ai-provider-ops", {
  namedExports: {
    getRadarAiProviderOperationsStatus: async () => {
      statusCalls += 1;
      return STATUS_FIXTURE;
    },
    getRadarAiProviderModelCatalog: async () => {
      catalogCalls += 1;
      return CATALOG_FIXTURE;
    },
    updateRadarAiProviderModel: async (providerId, modelId) => {
      updateCalls.push({ providerId, modelId });
      if (updateBehavior.throw) throw updateBehavior.throw;
      return STATUS_FIXTURE;
    },
  },
});

const {
  getRadarAiProviderOperationsStatusPageData,
  getRadarAiProviderModelCatalogPageData,
  saveRadarAiProviderModelAction,
} = await import("./radar-ai-provider-ops-ui.ts");

test.beforeEach(() => {
  permissionMode = "OWNER";
  permissionCalls = [];
  revalidateCalls = [];
  statusCalls = 0;
  catalogCalls = 0;
  updateCalls = [];
  updateBehavior = {};
});

test("getRadarAiProviderOperationsStatusPageData: RADAR_AI_POLICY_MANAGE gated, returns the status", async () => {
  const result = await getRadarAiProviderOperationsStatusPageData();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
  assert.deepEqual(result, STATUS_FIXTURE);
  assert.equal(statusCalls, 1);
});

test("getRadarAiProviderOperationsStatusPageData: denied caller -> redirect propagates, never falls through to the wrapped action", async () => {
  permissionMode = "DENY";
  await assert.rejects(() => getRadarAiProviderOperationsStatusPageData(), (err) => err.digest === "NEXT_REDIRECT;replace;/admin;307;");
});

test("getRadarAiProviderModelCatalogPageData: RADAR_AI_POLICY_MANAGE gated, returns the catalog", async () => {
  const result = await getRadarAiProviderModelCatalogPageData();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
  assert.deepEqual(result, CATALOG_FIXTURE);
  assert.equal(catalogCalls, 1);
});

test("saveRadarAiProviderModelAction: success -> ok:true with the fresh status, revalidates the settings page", async () => {
  const result = await saveRadarAiProviderModelAction("anthropic", "claude-sonnet-5");
  assert.deepEqual(result, { ok: true, status: STATUS_FIXTURE });
  assert.deepEqual(updateCalls, [{ providerId: "anthropic", modelId: "claude-sonnet-5" }]);
  assert.deepEqual(revalidateCalls, ["/admin/owner/ai-providers"]);
});

test("saveRadarAiProviderModelAction: a rejected update -> ok:false with a stable error code, never a raw server string", async () => {
  updateBehavior = { throw: new Error('invalid provider model update: unknown model id for provider "anthropic"') };
  const result = await saveRadarAiProviderModelAction("anthropic", "forged-model");
  assert.deepEqual(result, { ok: false, error: "INVALID_MODEL_UPDATE" });
  assert.deepEqual(revalidateCalls, []);
});

test("saveRadarAiProviderModelAction: an unrecognized thrown message propagates untouched (never silently swallowed)", async () => {
  updateBehavior = { throw: new Error("internal workspace is not configured") };
  await assert.rejects(() => saveRadarAiProviderModelAction("anthropic", "claude-sonnet-5"), /internal workspace is not configured/);
});

test("saveRadarAiProviderModelAction: a NEXT_REDIRECT thrown by the wrapped action is rethrown untouched, never mapped to a business code", async () => {
  const redirectErr = new Error("NEXT_REDIRECT");
  redirectErr.digest = "NEXT_REDIRECT;replace;/admin;307;";
  updateBehavior = { throw: redirectErr };
  await assert.rejects(() => saveRadarAiProviderModelAction("anthropic", "claude-sonnet-5"), (err) => err.digest === "NEXT_REDIRECT;replace;/admin;307;");
});

test("saveRadarAiProviderModelAction: RADAR_AI_POLICY_MANAGE gated at the wrapper too (defense in depth), before delegating", async () => {
  permissionMode = "DENY";
  await assert.rejects(() => saveRadarAiProviderModelAction("anthropic", "claude-sonnet-5"), (err) => err.digest === "NEXT_REDIRECT;replace;/admin;307;");
  assert.equal(updateCalls.length, 0);
});

test("neither providerId nor modelId is ever assumed to be a known-good type before reaching the wrapped validator -- forged non-string inputs pass through untouched", async () => {
  const result = await saveRadarAiProviderModelAction(12345, { forged: true });
  assert.deepEqual(updateCalls, [{ providerId: 12345, modelId: { forged: true } }]);
  assert.equal(result.ok, true); // the wrapped fake accepts anything; the REAL validator (radar-ai-provider-ops.test.mjs) proves the rejection.
});
