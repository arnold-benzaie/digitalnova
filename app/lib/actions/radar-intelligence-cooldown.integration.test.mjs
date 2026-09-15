// RADAR INTELLIGENCE V2.1 — Phase G4D — integration proof that the
// durable, per-user advisory cooldown (lib/actions/radar-intelligence.ts,
// backed by lib/api-v1/rate-limit.ts::checkRateLimit against the REAL
// `integration_api_rate_limit_hits` table) genuinely persists and is
// enforced ATOMICALLY across separate `requestRadarIntelligenceAdvisory()`
// invocations — not just against the in-memory fake used by
// radar-intelligence.test.mjs (which proves the ACTION's own wiring/
// contract, never the store's real durability/concurrency).
//
// SAFETY: the provider registry is mocked to ALWAYS return zero registered
// providers (`list: () => []`) — this is a deliberate, load-bearing
// guarantee that this file can NEVER cause a real network call to
// Anthropic/OpenAI, even if real provider API keys happen to be present in
// this shell's environment. Every other non-DB dependency (session, RADAR
// RBAC gate, locale, qualification, OWNER provider policy, model
// overrides) is mocked exactly like radar-intelligence.test.mjs — this
// file's only job is to prove the cooldown itself, not to re-prove RBAC or
// advisory-core's own logic (both already covered elsewhere).
//
// `@/db` and `@/lib/api-v1/rate-limit` are left REAL — the whole point of
// this file — running against the same fully isolated local Docker
// Postgres already used throughout this project's other
// *.integration.test.mjs files (public-map-approval-test-db, port 5434).
// NEVER Supabase/Neon/pooler, NEVER Production/Preview.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/actions/radar-intelligence-cooldown.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ne ressemble pas à la base locale jetable. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { namedExports: {} });

// RADAR RBAC gate — mocked to always admit, mirroring
// radar-intelligence.test.mjs. This file is not re-proving RBAC (see
// radar-queue.integration.test.mjs / crm-clients-radar-foundation.integration.test.mjs
// for the real Axis-C gate against a real staff_members row) — it only
// needs a stable identity to key the cooldown on.
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireRadarAccess: async () => "EMPLOYEE",
    evaluateStaffPermission: async () => ({ ok: false, reason: "permission-denied" }),
  },
});

let sessionUserId = "cooldown-integration-user";
mock.module("@/lib/session", { namedExports: { requireSession: async () => ({ userId: sessionUserId, role: "staff" }) } });

mock.module("@/lib/i18n/locale", { namedExports: { getLocale: async () => "fr" } });

// QUALIFIED with a non-null opportunity — required for produceRadarAdvisory
// to reach the quota gate / registry construction at all (a NOT-qualified
// prospect short-circuits to "not_applicable" before the cooldown's own
// downstream code ever runs, which would make it impossible to observe the
// cooldown's effect via the returned status).
mock.module("@/lib/actions/radar", {
  namedExports: {
    getProspectQualification: async () => ({
      qualificationStatus: "QUALIFIED",
      eligibility: { contactable: true },
      opportunity: {
        priority: "medium",
        confidence: "medium",
        recommendedNextAction: "call",
        reasons: [],
      },
    }),
  },
});

// LOAD-BEARING SAFETY GUARANTEE — see file header. `createConfiguredRadarIntelligenceRegistry`
// (the real factory that would register live Anthropic/OpenAI adapters
// from env credentials) is replaced with the REAL, empty `ProviderRegistry`
// (lib/radar-intelligence/provider-registry.ts::createProviderRegistry(),
// never populated) — structurally the exact same object shape the router
// expects (`has`/`get`/`list`/register), just with zero adapters ever
// added, so the router can only ever resolve NO_CAPABLE_PROVIDER ->
// { status: "unavailable" }. No adapter is ever constructed, no HTTP call
// is ever possible, regardless of any real provider API key present in
// this shell's environment.
const { createProviderRegistry } = await import("@/lib/radar-intelligence/provider-registry");
mock.module("@/lib/radar-intelligence/configured-registry", {
  namedExports: {
    createConfiguredRadarIntelligenceRegistry: () => createProviderRegistry(),
  },
});

// OWNER provider policy / model overrides — the real, complete
// DEFAULT_PROVIDER_POLICY shape (a hand-rolled partial object here would
// make resolveProviderPolicy() operate on an ill-typed policy); not what
// this file tests, since the registry above is empty regardless of mode.
const { DEFAULT_PROVIDER_POLICY } = await import("@/lib/radar-intelligence/provider-policy");
mock.module("@/lib/radar-intelligence/provider-policy-store", {
  namedExports: { loadProviderPolicy: async () => DEFAULT_PROVIDER_POLICY },
});
mock.module("@/lib/radar-intelligence/provider-runtime-config-store", {
  namedExports: { loadProviderModelOverrides: async () => ({}) },
});

const { db } = await import("@/db");
const { crmClients } = await import("@/db/schema");
const { requestRadarIntelligenceAdvisory } = await import("./radar-intelligence.ts");

const createdClientIds = new Set();

async function makeClient() {
  const [client] = await db
    .insert(crmClients)
    .values({
      name: `G4D Cooldown Integration ${randomUUID()}`,
      email: "prospect@example.test",
      stage: "prospect",
    })
    .returning();
  createdClientIds.add(client.id);
  return client;
}

after(async () => {
  if (createdClientIds.size > 0) {
    const { inArray } = await import("drizzle-orm");
    await db.delete(crmClients).where(inArray(crmClients.id, Array.from(createdClientIds)));
  }
});

function withCapturedWarn() {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => calls.push(args);
  return {
    calls,
    restore: () => {
      console.warn = original;
    },
  };
}

test("G4D integration: first call for a fresh user reaches the core (unavailable — zero providers); an IMMEDIATE second call for the SAME user is rate_limited by the REAL durable store", async () => {
  sessionUserId = `g4d-user-${randomUUID()}`;
  const client = await makeClient();

  const first = await requestRadarIntelligenceAdvisory(client.id);
  assert.deepEqual(first, { status: "unavailable" });

  const second = await requestRadarIntelligenceAdvisory(client.id);
  assert.deepEqual(second, { status: "rate_limited" }, "the SAME user, immediately again, must be throttled by the real checkRateLimit-backed store");
});

test("G4D integration: a DIFFERENT user is unaffected by another user's cooldown window (per-identifier isolation, proven against the real table)", async () => {
  const clientA = await makeClient();
  const clientB = await makeClient();

  sessionUserId = `g4d-user-a-${randomUUID()}`;
  const first = await requestRadarIntelligenceAdvisory(clientA.id);
  assert.deepEqual(first, { status: "unavailable" });
  const throttled = await requestRadarIntelligenceAdvisory(clientA.id);
  assert.deepEqual(throttled, { status: "rate_limited" });

  sessionUserId = `g4d-user-b-${randomUUID()}`;
  const otherUserFirst = await requestRadarIntelligenceAdvisory(clientB.id);
  assert.deepEqual(otherUserFirst, { status: "unavailable" }, "a different identifier must never be throttled by another user's window");
});

test("G4D integration: concurrent (Promise.all) requests from the SAME user against the REAL store admit exactly one, throttle the rest — proves the atomic INSERT ... ON CONFLICT contract under real concurrency", async () => {
  sessionUserId = `g4d-concurrent-user-${randomUUID()}`;
  const client = await makeClient();

  const results = await Promise.all(Array.from({ length: 6 }, () => requestRadarIntelligenceAdvisory(client.id)));

  const admitted = results.filter((r) => r.status === "unavailable");
  const throttled = results.filter((r) => r.status === "rate_limited");
  assert.equal(admitted.length, 1, "exactly one concurrent request must reach the core");
  assert.equal(throttled.length, 5, "every other concurrent request must be throttled by the same atomic window");
});

test("G4D integration: the cooldown never blocks/duplicates when a DIFFERENT clientId is requested by the SAME user — the window is keyed by USER, not by client", async () => {
  sessionUserId = `g4d-same-user-two-clients-${randomUUID()}`;
  const clientA = await makeClient();
  const clientB = await makeClient();

  const first = await requestRadarIntelligenceAdvisory(clientA.id);
  assert.deepEqual(first, { status: "unavailable" });

  // Same user, a DIFFERENT client — still throttled, proving the window
  // key is the session userId alone, never clientId.
  const second = await requestRadarIntelligenceAdvisory(clientB.id);
  assert.deepEqual(second, { status: "rate_limited" });
});

test("G4D integration: with a REAL rate-limit store outage simulated by closing the pool mid-call is out of scope here (proven at the unit level by radar-intelligence.test.mjs's fail-open test) — this file instead proves the HAPPY-PATH real store never spuriously blocks a legitimate first request", async () => {
  sessionUserId = `g4d-happy-path-${randomUUID()}`;
  const client = await makeClient();
  const { calls, restore } = withCapturedWarn();
  try {
    const result = await requestRadarIntelligenceAdvisory(client.id);
    assert.deepEqual(result, { status: "unavailable" });
    const cooldownOutageLogs = calls.filter((args) => args[1]?.code === "COOLDOWN_STORE_UNAVAILABLE");
    assert.equal(cooldownOutageLogs.length, 0, "a healthy real store must never emit COOLDOWN_STORE_UNAVAILABLE");
  } finally {
    restore();
  }
});
