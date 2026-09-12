// RADAR INTELLIGENCE V2.1 — Phase E — lib/actions/radar-ai-provider-ops.ts tests.
//
// @/lib/rbac/require-staff-member, @/lib/session, @/lib/notifications,
// @/lib/audit, @/lib/radar-intelligence/config-loader,
// @/lib/radar-intelligence/provider-runtime-config-store,
// @/lib/actions/radar-ai-policy and server-only are all mocked -- this
// suite touches no live Postgres connection, no Next.js runtime, and
// dispatches zero provider calls.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-ai-provider-ops.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

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

const SESSION_USER_ID = "32371e8f-fc5e-4add-a7e4-9d4baf84252e";
mock.module("@/lib/session", {
  namedExports: { requireSession: async () => ({ userId: SESSION_USER_ID }) },
});

const INTERNAL_ORG_ID = "e35cbc31-9604-4324-adc6-f6f5c1ffc248";
let internalOrgId = INTERNAL_ORG_ID;
mock.module("@/lib/notifications", {
  namedExports: { getInternalOrganizationId: async () => internalOrgId },
});

/** @type {Array<Record<string, unknown>>} */
let auditCalls = [];
mock.module("@/lib/audit", {
  namedExports: {
    logAudit: async (input) => {
      auditCalls.push(input);
    },
  },
});

/** @type {{ anthropic: any; openai: any }} */
let loadedConfig = {
  anthropic: { enabledFlag: true, hasCredential: true, effectiveEnabled: true, model: "claude-sonnet-4-5", apiKey: "sk-ant-FAKE", maxOutputTokens: 512, maxRequestBytes: 24000 },
  openai: { enabledFlag: false, hasCredential: false, effectiveEnabled: false, model: "gpt-4o-mini", apiKey: null, maxOutputTokens: 512, maxRequestBytes: 24000 },
};
mock.module("@/lib/radar-intelligence/config-loader", {
  namedExports: { loadRadarIntelligenceConfig: () => loadedConfig },
});

/** @type {Record<string, string>} */
let storedOverrides = {};
/** @type {Array<{ providerId: string; modelId: string; updatedByStaffMemberId: string | null }>} */
let setOverrideCalls = [];
mock.module("@/lib/radar-intelligence/provider-runtime-config-store", {
  namedExports: {
    loadProviderModelOverrides: async () => storedOverrides,
    setProviderModelOverride: async (providerId, modelId, updatedByStaffMemberId) => {
      setOverrideCalls.push({ providerId, modelId, updatedByStaffMemberId });
      storedOverrides = { ...storedOverrides, [providerId]: modelId };
    },
  },
});

const STAFF_MEMBER_ID = "aaaaaaa1-1111-4111-8111-111111111111";
let resolveActingStaffMemberIdCalls = [];
mock.module("@/lib/actions/radar-ai-policy", {
  namedExports: {
    resolveActingStaffMemberId: async (userId, orgId) => {
      resolveActingStaffMemberIdCalls.push({ userId, orgId });
      return STAFF_MEMBER_ID;
    },
  },
});

const {
  getRadarAiProviderOperationsStatus,
  getRadarAiProviderModelCatalog,
  updateRadarAiProviderModel,
} = await import("./radar-ai-provider-ops.ts");

test.beforeEach(() => {
  permissionMode = "OWNER";
  permissionCalls = [];
  internalOrgId = INTERNAL_ORG_ID;
  auditCalls = [];
  storedOverrides = {};
  setOverrideCalls = [];
  resolveActingStaffMemberIdCalls = [];
  loadedConfig = {
    anthropic: { enabledFlag: true, hasCredential: true, effectiveEnabled: true, model: "claude-sonnet-4-5", apiKey: "sk-ant-FAKE", maxOutputTokens: 512, maxRequestBytes: 24000 },
    openai: { enabledFlag: false, hasCredential: false, effectiveEnabled: false, model: "gpt-4o-mini", apiKey: null, maxOutputTokens: 512, maxRequestBytes: 24000 },
  };
});

// ---- RBAC ----

test("getRadarAiProviderOperationsStatus: OWNER permission is checked first, via RADAR_AI_POLICY_MANAGE", async () => {
  await getRadarAiProviderOperationsStatus();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
});

test("getRadarAiProviderOperationsStatus: denied caller -> the redirect propagates untouched", async () => {
  permissionMode = "DENY";
  await assert.rejects(() => getRadarAiProviderOperationsStatus(), (err) => err.digest === "NEXT_REDIRECT;replace;/admin;307;");
});

test("getRadarAiProviderModelCatalog: RADAR_AI_POLICY_MANAGE gated", async () => {
  await getRadarAiProviderModelCatalog();
  assert.deepEqual(permissionCalls, ["RADAR_AI_POLICY_MANAGE"]);
});

test("updateRadarAiProviderModel: RADAR_AI_POLICY_MANAGE gated, checked BEFORE any validation/DB call", async () => {
  permissionMode = "DENY";
  await assert.rejects(() => updateRadarAiProviderModel("anthropic", "claude-sonnet-5"), (err) => err.digest === "NEXT_REDIRECT;replace;/admin;307;");
  assert.equal(setOverrideCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

// ---- getRadarAiProviderOperationsStatus: safe status shape ----

test("getRadarAiProviderOperationsStatus: returns exactly the two policy-configurable providers", async () => {
  const status = await getRadarAiProviderOperationsStatus();
  assert.deepEqual(status.map((s) => s.providerId).sort(), ["anthropic", "openai"]);
});

test("getRadarAiProviderOperationsStatus: never carries an apiKey / secret / token field on any entry", async () => {
  const status = await getRadarAiProviderOperationsStatus();
  for (const s of status) {
    assert.deepEqual(Object.keys(s).sort(), ["providerId", "credentialStatus", "enabled", "model", "modelIsOverridden", "operationalState"].sort());
  }
});

test("getRadarAiProviderOperationsStatus: JSON-serialized result never contains the fake configured api key", async () => {
  const status = await getRadarAiProviderOperationsStatus();
  assert.ok(!JSON.stringify(status).includes("sk-ant-FAKE"));
});

test("getRadarAiProviderOperationsStatus: anthropic configured+enabled -> credentialStatus configured, enabled true, operationalState ready", async () => {
  const status = await getRadarAiProviderOperationsStatus();
  const a = status.find((s) => s.providerId === "anthropic");
  assert.equal(a.credentialStatus, "configured");
  assert.equal(a.enabled, true);
  assert.equal(a.operationalState, "ready");
  assert.equal(a.model, "claude-sonnet-4-5");
  assert.equal(a.modelIsOverridden, false);
});

test("getRadarAiProviderOperationsStatus: openai disabled+no credential -> not_configured, disabled, operationalState unknown (never falsely 'ready')", async () => {
  const status = await getRadarAiProviderOperationsStatus();
  const o = status.find((s) => s.providerId === "openai");
  assert.equal(o.credentialStatus, "not_configured");
  assert.equal(o.enabled, false);
  assert.equal(o.operationalState, "unknown");
});

test("getRadarAiProviderOperationsStatus: enabled flag ON but NO credential -> operationalState configuration_issue (a real detectable misconfiguration)", async () => {
  loadedConfig.openai = { ...loadedConfig.openai, enabledFlag: true, hasCredential: false, effectiveEnabled: false };
  const status = await getRadarAiProviderOperationsStatus();
  const o = status.find((s) => s.providerId === "openai");
  assert.equal(o.operationalState, "configuration_issue");
});

test("getRadarAiProviderOperationsStatus: credential present but NOT enabled -> operationalState unknown, never ready", async () => {
  loadedConfig.openai = { ...loadedConfig.openai, enabledFlag: false, hasCredential: true, effectiveEnabled: false };
  const status = await getRadarAiProviderOperationsStatus();
  const o = status.find((s) => s.providerId === "openai");
  assert.equal(o.operationalState, "unknown");
  assert.equal(o.credentialStatus, "configured");
});

test("getRadarAiProviderOperationsStatus: a valid stored override REPLACES the displayed model and sets modelIsOverridden true", async () => {
  storedOverrides = { anthropic: "claude-sonnet-5" };
  const status = await getRadarAiProviderOperationsStatus();
  const a = status.find((s) => s.providerId === "anthropic");
  assert.equal(a.model, "claude-sonnet-5");
  assert.equal(a.modelIsOverridden, true);
});

test("getRadarAiProviderOperationsStatus: an unknown stored override id is ignored -- falls back to env model, modelIsOverridden false", async () => {
  storedOverrides = { anthropic: "claude-opus-9000-forged" };
  const status = await getRadarAiProviderOperationsStatus();
  const a = status.find((s) => s.providerId === "anthropic");
  assert.equal(a.model, "claude-sonnet-4-5");
  assert.equal(a.modelIsOverridden, false);
});

test("getRadarAiProviderOperationsStatus: zero provider calls -- no fetch-shaped dependency exists anywhere in this module", async () => {
  const source = await (await import("node:fs/promises")).readFile(new URL("./radar-ai-provider-ops.ts", import.meta.url), "utf8");
  assert.equal(/\bfetch\(/.test(source), false);
});

// ---- getRadarAiProviderModelCatalog ----

test("getRadarAiProviderModelCatalog: returns the real static catalog, keyed by provider", async () => {
  const catalog = await getRadarAiProviderModelCatalog();
  assert.deepEqual(Object.keys(catalog).sort(), ["anthropic", "openai"]);
  assert.ok(catalog.anthropic.some((m) => m.id === "claude-sonnet-4-5"));
  assert.ok(catalog.openai.some((m) => m.id === "gpt-4o-mini"));
});

// ---- updateRadarAiProviderModel: validation ----

test("updateRadarAiProviderModel: unknown provider id -> rejected, no write, no audit", async () => {
  await assert.rejects(() => updateRadarAiProviderModel("gemini", "claude-sonnet-5"), /invalid provider model update: unknown provider id/);
  assert.equal(setOverrideCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("updateRadarAiProviderModel: unknown model id -> rejected, no write, no audit", async () => {
  await assert.rejects(() => updateRadarAiProviderModel("anthropic", "claude-opus-9000-forged"), /invalid provider model update: unknown model id/);
  assert.equal(setOverrideCalls.length, 0);
  assert.equal(auditCalls.length, 0);
});

test("updateRadarAiProviderModel: provider/model mismatch (openai model for anthropic) -> rejected", async () => {
  await assert.rejects(() => updateRadarAiProviderModel("anthropic", "gpt-4o-mini"), /invalid provider model update/);
  assert.equal(setOverrideCalls.length, 0);
});

test("updateRadarAiProviderModel: non-string modelId -> rejected", async () => {
  await assert.rejects(() => updateRadarAiProviderModel("anthropic", 12345), /invalid provider model update/);
});

test("updateRadarAiProviderModel: internal workspace not configured -> throws, no write", async () => {
  internalOrgId = null;
  await assert.rejects(() => updateRadarAiProviderModel("anthropic", "claude-sonnet-5"), /internal workspace is not configured/);
  assert.equal(setOverrideCalls.length, 0);
});

// ---- updateRadarAiProviderModel: success path ----

test("updateRadarAiProviderModel: valid update -> writes exactly once with the server-resolved staff member id, never a client-supplied one", async () => {
  await updateRadarAiProviderModel("anthropic", "claude-sonnet-5");
  assert.equal(setOverrideCalls.length, 1);
  assert.equal(setOverrideCalls[0].providerId, "anthropic");
  assert.equal(setOverrideCalls[0].modelId, "claude-sonnet-5");
  assert.equal(setOverrideCalls[0].updatedByStaffMemberId, STAFF_MEMBER_ID);
  assert.deepEqual(resolveActingStaffMemberIdCalls, [{ userId: SESSION_USER_ID, orgId: INTERNAL_ORG_ID }]);
});

test("updateRadarAiProviderModel: writes exactly ONE radar_ai.model_changed audit record with a non-secret snapshot", async () => {
  await updateRadarAiProviderModel("anthropic", "claude-sonnet-5");
  assert.equal(auditCalls.length, 1);
  const entry = auditCalls[0];
  assert.equal(entry.action, "radar_ai.model_changed");
  assert.equal(entry.actorUserId, SESSION_USER_ID);
  assert.equal(entry.organizationId, INTERNAL_ORG_ID);
  assert.equal(entry.targetType, "radar_ai_provider_runtime_config");
  assert.equal(entry.targetId, "anthropic");
  assert.deepEqual(entry.metadata, { providerId: "anthropic", beforeModel: "claude-sonnet-4-5", afterModel: "claude-sonnet-5" });
});

test("updateRadarAiProviderModel: audit metadata never contains a key/secret/token/prefix/hash field, no matter what", async () => {
  await updateRadarAiProviderModel("anthropic", "claude-sonnet-5");
  const metadata = auditCalls[0].metadata;
  assert.deepEqual(Object.keys(metadata).sort(), ["providerId", "beforeModel", "afterModel"].sort());
  assert.ok(!JSON.stringify(metadata).includes("sk-ant-FAKE"));
});

test("updateRadarAiProviderModel: beforeModel reflects a PRE-EXISTING override, not just the env default, when one was already stored", async () => {
  storedOverrides = { anthropic: "claude-sonnet-5" };
  await updateRadarAiProviderModel("anthropic", "claude-sonnet-4-5");
  assert.equal(auditCalls[0].metadata.beforeModel, "claude-sonnet-5");
  assert.equal(auditCalls[0].metadata.afterModel, "claude-sonnet-4-5");
});

test("updateRadarAiProviderModel: returns the fresh operations status reflecting the new override", async () => {
  const result = await updateRadarAiProviderModel("anthropic", "claude-sonnet-5");
  const a = result.find((s) => s.providerId === "anthropic");
  assert.equal(a.model, "claude-sonnet-5");
  assert.equal(a.modelIsOverridden, true);
});

test("updateRadarAiProviderModel: changing openai never touches anthropic's stored override", async () => {
  storedOverrides = { anthropic: "claude-sonnet-5" };
  loadedConfig.openai = { ...loadedConfig.openai, enabledFlag: true, hasCredential: true, effectiveEnabled: true };
  await updateRadarAiProviderModel("openai", "gpt-5.6-terra");
  assert.equal(storedOverrides.anthropic, "claude-sonnet-5");
  assert.equal(storedOverrides.openai, "gpt-5.6-terra");
});
