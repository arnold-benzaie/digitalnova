// RADAR INTELLIGENCE V1 — Slice 3 — internal provider-status service tests.
//
// Proves:
//   - requireStaffMember("SYSTEM_ADMIN") is the FIRST thing; a denial
//     stops everything (no status computed)
//   - the view carries ONLY provider/connection/health/enabled/capabilities
//     — never an apiKey, model, headers, raw body, or env contents
//   - disabled / configured-but-unreachable / degraded / connected are all
//     reported correctly from fake config + fake transports
//
// @/lib/rbac/require-staff-member and server-only are mocked.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/provider-status.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

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
      return "ADMIN";
    },
  },
});

const { getRadarIntelligenceProviderStatus } = await import("./provider-status.ts");
const { createProviderRegistry } = await import("./provider-registry.ts");
const { deterministicFallbackAdapter } = await import("./deterministic-fallback.ts");
const { createAnthropicAdapter } = await import("./adapters/anthropic.ts");

const FAKE_KEY = "sk-ant-THIS-MUST-NEVER-LEAK";
const clock = () => new Date("2026-09-12T09:00:00.000Z");

function fakeTransport(health) {
  return {
    async generate() {
      return { body: { summary: "x" } };
    },
    describeHealth() {
      return health;
    },
  };
}

function reset() {
  permissionCalls = [];
  denyMode = false;
}

function registryWith(anthropicOpts) {
  const reg = createProviderRegistry();
  reg.register(deterministicFallbackAdapter);
  if (anthropicOpts) reg.register(createAnthropicAdapter({ ...anthropicOpts, clock }));
  return reg;
}

test("status: SYSTEM_ADMIN is required first; default (no config) -> only the deterministic provider, DISCONNECTED", async () => {
  reset();
  const view = await getRadarIntelligenceProviderStatus({ registry: registryWith(null) });
  assert.deepEqual(permissionCalls, ["SYSTEM_ADMIN"]);
  assert.deepEqual(view.providers.map((p) => p.provider), ["deterministic"]);
  assert.equal(view.providers[0].connection, "DISCONNECTED");
});

test("status: a guard denial propagates — no view, guard asked exactly SYSTEM_ADMIN", async () => {
  reset();
  denyMode = true;
  await assert.rejects(() => getRadarIntelligenceProviderStatus({ registry: registryWith(null) }), /NEXT_REDIRECT/);
  assert.deepEqual(permissionCalls, ["SYSTEM_ADMIN"]);
});

test("status: view carries ONLY safe fields — no apiKey / model / headers / body / env", async () => {
  reset();
  const view = await getRadarIntelligenceProviderStatus({
    registry: registryWith({ config: { enabled: true }, transport: fakeTransport({ reachable: true, degraded: false }) }),
  });
  for (const p of view.providers) {
    assert.deepEqual(Object.keys(p).sort(), ["capabilities", "connection", "enabled", "health", "provider"].sort());
  }
  const s = JSON.stringify(view);
  assert.ok(!s.includes(FAKE_KEY));
  assert.ok(!s.toLowerCase().includes("apikey"));
  assert.ok(!s.toLowerCase().includes("x-api-key"));
  assert.ok(!s.includes("claude-sonnet")); // model name not exposed
  assert.ok(!s.toLowerCase().includes("authorization"));
});

test("status: disabled anthropic -> connection DISABLED, enabled false", async () => {
  reset();
  const view = await getRadarIntelligenceProviderStatus({ registry: registryWith({ config: { enabled: false }, transport: fakeTransport({ reachable: true, degraded: false }) }) });
  const anthropic = view.providers.find((p) => p.provider === "anthropic");
  assert.equal(anthropic.connection, "DISABLED");
  assert.equal(anthropic.enabled, false);
  assert.deepEqual(anthropic.capabilities, []);
});

test("status: configured-but-unreachable -> DISCONNECTED / UNHEALTHY", async () => {
  reset();
  const view = await getRadarIntelligenceProviderStatus({ registry: registryWith({ config: { enabled: true }, transport: fakeTransport({ reachable: false, degraded: false }) }) });
  const anthropic = view.providers.find((p) => p.provider === "anthropic");
  assert.equal(anthropic.connection, "DISCONNECTED");
  assert.equal(anthropic.health, "UNHEALTHY");
  assert.equal(anthropic.enabled, true);
});

test("status: degraded transport -> DEGRADED / UNHEALTHY", async () => {
  reset();
  const view = await getRadarIntelligenceProviderStatus({ registry: registryWith({ config: { enabled: true }, transport: fakeTransport({ reachable: true, degraded: true }) }) });
  const anthropic = view.providers.find((p) => p.provider === "anthropic");
  assert.equal(anthropic.connection, "DEGRADED");
  assert.equal(anthropic.health, "UNHEALTHY");
});

test("status: connected transport -> CONNECTED / HEALTHY / summarize capability", async () => {
  reset();
  const view = await getRadarIntelligenceProviderStatus({ registry: registryWith({ config: { enabled: true }, transport: fakeTransport({ reachable: true, degraded: false }) }) });
  const anthropic = view.providers.find((p) => p.provider === "anthropic");
  assert.equal(anthropic.connection, "CONNECTED");
  assert.equal(anthropic.health, "HEALTHY");
  assert.deepEqual(anthropic.capabilities, ["summarize"]);
});
