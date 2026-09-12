// RADAR INTELLIGENCE V2.1 — Phase C/E — focused test for the
// /admin/owner/ai-providers protected route. Proves: (1) the
// authorization boundary is the FIRST thing that runs and asks for
// exactly "RADAR_AI_POLICY_MANAGE"; (2) the policy is read through the
// RADAR_AI_POLICY_MANAGE-gated wrapper, never a direct DB/store call from
// the page; (3) provider status is read through the existing
// SYSTEM_ADMIN-gated infrastructure (never a new exposure surface); (4) a
// guard denial produces no page content and no reads; (5) caller-supplied
// input changes nothing; (6) Phase E — the operations status and model
// catalog are ALSO read through their own RADAR_AI_POLICY_MANAGE-gated
// wrappers, never a direct DB call from the page, and never reached by a
// denied caller either.
//
// @/lib/rbac/require-staff-member, @/lib/actions/radar-ai-policy-ui,
// @/lib/actions/radar-ai-provider-ops-ui and
// @/lib/radar-intelligence/provider-status are mocked at the module
// boundary so no live Postgres / Next runtime is needed. getLocale() is
// left real (returns "fr" outside a request). @/lib/radar-intelligence/credential-operations
// is ALSO mocked, at the exact specifier the page imports
// CREDENTIAL_OPERATIONS_CAPABILITY from.
//
// Run with: npx tsx --test --experimental-test-module-mocks app/admin/owner/ai-providers/page.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

let permissionCalls = [];
let denyMode = false;
let policyCalls = 0;
let statusCalls = 0;
let operationsStatusCalls = 0;
let modelCatalogCalls = 0;

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

const DEFAULT_POLICY = {
  mode: "AUTO",
  defaultProvider: "anthropic",
  fallbackOrder: ["anthropic", "openai"],
  enabledProviders: ["anthropic", "openai"],
  userSelectableProviders: [],
  allowUserSelection: false,
  fallbackEnabled: true,
};

mock.module("@/lib/actions/radar-ai-policy-ui", {
  namedExports: {
    getRadarAiProviderPolicyPageData: async () => {
      policyCalls += 1;
      return { policy: DEFAULT_POLICY, updatedAt: null };
    },
    saveRadarAiProviderPolicyAction: async () => ({ ok: true, policy: DEFAULT_POLICY }),
    resetRadarAiProviderPolicyAction: async () => ({ ok: true, policy: DEFAULT_POLICY }),
  },
});

mock.module("@/lib/radar-intelligence/provider-status", {
  namedExports: {
    getRadarIntelligenceProviderStatus: async () => {
      statusCalls += 1;
      return {
        providers: [
          { provider: "anthropic", connection: "DISABLED", health: "HEALTHY", enabled: false, capabilities: [], configured: false },
          { provider: "openai", connection: "DISABLED", health: "HEALTHY", enabled: false, capabilities: [], configured: true },
        ],
      };
    },
  },
});

const OPERATIONS_STATUS_FIXTURE = [
  { providerId: "anthropic", credentialStatus: "not_configured", enabled: false, model: "claude-sonnet-4-5", modelIsOverridden: false, operationalState: "unknown" },
  { providerId: "openai", credentialStatus: "configured", enabled: false, model: "gpt-4o-mini", modelIsOverridden: false, operationalState: "unknown" },
];
const MODEL_CATALOG_FIXTURE = {
  anthropic: [{ providerId: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", status: "active" }],
  openai: [{ providerId: "openai", id: "gpt-4o-mini", label: "GPT-4o mini", status: "active" }],
};

mock.module("@/lib/actions/radar-ai-provider-ops-ui", {
  namedExports: {
    getRadarAiProviderOperationsStatusPageData: async () => {
      operationsStatusCalls += 1;
      return OPERATIONS_STATUS_FIXTURE;
    },
    getRadarAiProviderModelCatalogPageData: async () => {
      modelCatalogCalls += 1;
      return MODEL_CATALOG_FIXTURE;
    },
    saveRadarAiProviderModelAction: async () => ({ ok: true, status: OPERATIONS_STATUS_FIXTURE }),
  },
});

mock.module("@/lib/radar-intelligence/credential-operations", {
  namedExports: { CREDENTIAL_OPERATIONS_CAPABILITY: "external-only" },
});

const { default: AiProvidersOwnerPage } = await import("./page.tsx");

function reset() {
  permissionCalls = [];
  denyMode = false;
  policyCalls = 0;
  statusCalls = 0;
  operationsStatusCalls = 0;
  modelCatalogCalls = 0;
}

test("Phase C page: authorized -> renders; guard called exactly once with 'RADAR_AI_POLICY_MANAGE'; policy + status read via the gated wrappers", async () => {
  reset();
  const el = await AiProvidersOwnerPage();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
  assert.equal(policyCalls, 1, "the page reads the policy through getRadarAiProviderPolicyPageData()");
  assert.equal(statusCalls, 1, "the page reads provider status through getRadarIntelligenceProviderStatus()");
  assert.ok(el, "expected a React element when authorized");
});

test("Phase E: authorized -> the operations status and model catalog are ALSO read, exactly once each, through their own gated wrappers", async () => {
  reset();
  await AiProvidersOwnerPage();
  assert.equal(operationsStatusCalls, 1, "the page reads operations status through getRadarAiProviderOperationsStatusPageData()");
  assert.equal(modelCatalogCalls, 1, "the page reads the model catalog through getRadarAiProviderModelCatalogPageData()");
});

test("Phase C page: never asks for SYSTEM_ADMIN or OWNER_MANAGE directly -- only RADAR_AI_POLICY_MANAGE", async () => {
  reset();
  await AiProvidersOwnerPage();
  assert.ok(!permissionCalls.includes("SYSTEM_ADMIN"));
  assert.ok(!permissionCalls.includes("OWNER_MANAGE"));
});

test("Phase C page: a guard denial (NEXT_REDIRECT) propagates -- no policy/status read, no page content", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => AiProvidersOwnerPage(), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"], "the guard still ran, with exactly RADAR_AI_POLICY_MANAGE, before any read");
  assert.equal(policyCalls, 0, "a denied caller never reaches the policy read");
  assert.equal(statusCalls, 0, "a denied caller never reaches the status read");
  assert.equal(operationsStatusCalls, 0, "a denied caller never reaches the Phase E operations-status read");
  assert.equal(modelCatalogCalls, 0, "a denied caller never reaches the Phase E model-catalog read");
});

test("Phase C page: authorization ignores caller-supplied input -- a forged { searchParams } / { params } changes nothing", async () => {
  reset();
  const el = await AiProvidersOwnerPage({ searchParams: { canManageAiPolicy: "true", role: "OWNER" }, params: { workspace: "other-org" } });
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"], "still exactly RADAR_AI_POLICY_MANAGE -- no caller value influences the check");
  assert.ok(el);
});

test("Phase C page: the component declares no parameters (nothing to read canManageAiPolicy / email / workspace / role from)", () => {
  assert.equal(AiProvidersOwnerPage.length, 0);
});

test("Phase C page: no secret-shaped value (apiKey/env/credential) appears anywhere in the rendered element tree's props", async () => {
  reset();
  const el = await AiProvidersOwnerPage();
  const s = JSON.stringify(el, (key, value) => (typeof value === "function" ? "[fn]" : value));
  assert.equal(/apiKey|sk-ant-|sk-proj-|DATABASE_URL/i.test(s), false);
});
