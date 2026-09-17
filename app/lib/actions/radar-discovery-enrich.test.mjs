// MISSION C-2D-4-E — radar-discovery-enrich.ts unit tests. Every
// collaborator is mocked at the module boundary (same technique as
// lib/actions/radar-discovery-search.test.mjs / radar-discovery-convert.test.mjs)
// — no real DB, no real Google call. isValidUuid() is deliberately LEFT
// REAL (pure, already unit-tested on its own).
//
// The REAL claim/lease atomicity, transactional finalize, and concurrency
// behavior are proven against a disposable Postgres by
// radar-discovery-enrich.integration.test.mjs.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-discovery-enrich.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

// ---- RBAC ----
let permissionCalls = [];
let denyMode = false;
mock.module("@/lib/rbac/require-staff-member", {
  namedExports: {
    requireRadarAccess: async (permission) => {
      permissionCalls.push(permission);
      if (denyMode) {
        const err = new Error("NEXT_REDIRECT");
        err.digest = "NEXT_REDIRECT;replace;/admin;307;";
        throw err;
      }
      return "EMPLOYEE";
    },
  },
});

// ---- session ----
let sessionUserId = "actor-user-1";
mock.module("@/lib/session", { namedExports: { requireSession: async () => ({ userId: sessionUserId, role: "staff" }) } });

// ---- actor rate limit (Enrichment's OWN scope) ----
let actorRateLimitCalls = [];
let actorRateLimitResult = { allowed: true };
mock.module("@/lib/radar-discovery/actor-rate-limit", {
  namedExports: {
    checkDiscoveryEnrichmentActorRateLimit: async (userId) => {
      actorRateLimitCalls.push(userId);
      return actorRateLimitResult;
    },
  },
});

// ---- provider ----
let configuredProviderCalls = 0;
let providerInstance = null; // null = "not configured"
mock.module("@/lib/radar-discovery/adapters/configured-google-places", {
  namedExports: {
    createConfiguredGooglePlacesProvider: () => {
      configuredProviderCalls += 1;
      return providerInstance;
    },
  },
});

// ---- discovery-result-store: claim / release / finalize ----
let claimCalls = [];
let claimResult = { status: "claimed", row: { id: "row-1", sourceId: "ChIJ_place_1", enrichmentClaimedAt: new Date("2026-01-01T00:00:00Z") } };
let releaseCalls = [];
let finalizeCalls = [];
let finalizeResult = { status: "enriched", row: { phone: "+33 1 42 00 00 01", website: "https://example.test", openingHours: null, businessStatus: "OPERATIONAL" } };
mock.module("@/lib/radar-discovery/discovery-result-store", {
  namedExports: {
    claimDiscoveryResultForEnrichment: async (id, options) => {
      claimCalls.push({ id, options });
      return claimResult;
    },
    releaseDiscoveryResultEnrichmentClaim: async (id, claimedAt) => {
      releaseCalls.push({ id, claimedAt });
    },
    finalizeDiscoveryResultEnrichment: async (id, claimedAt, patch, actorUserId) => {
      finalizeCalls.push({ id, claimedAt, patch, actorUserId });
      return finalizeResult;
    },
  },
});

const { enrichDiscoveryResult } = await import("./radar-discovery-enrich.ts");

const VALID_ID = "d15c0000-0000-4000-8000-000000000001";

function reset() {
  permissionCalls = [];
  denyMode = false;
  sessionUserId = "actor-user-1";
  actorRateLimitCalls = [];
  actorRateLimitResult = { allowed: true };
  configuredProviderCalls = 0;
  providerInstance = {
    id: "google_places",
    capabilities: () => ["search", "get_details"],
    health: () => ({ id: "google_places", state: "connected", capabilities: ["search", "get_details"], lastCheckedAt: null }),
    search: async () => ({ results: [], nextCursor: null }),
    getDetails: async () => ({ result: { phone: "+33 1 42 00 00 01", website: "https://example.test", openingHours: null, businessStatus: "OPERATIONAL" } }),
  };
  claimCalls = [];
  claimResult = { status: "claimed", row: { id: "row-1", sourceId: "ChIJ_place_1", enrichmentClaimedAt: new Date("2026-01-01T00:00:00Z") } };
  releaseCalls = [];
  finalizeCalls = [];
  finalizeResult = { status: "enriched", row: { phone: "+33 1 42 00 00 01", website: "https://example.test", openingHours: null, businessStatus: "OPERATIONAL" } };
}
test.beforeEach(reset);

// ---- AUTHORIZATION ----

test("AUTHORIZATION: requireRadarAccess('RADAR_DISCOVERY_ENRICH') runs first, before any other side effect -- a DEDICATED permission, never RADAR_QUEUE_VIEW/RADAR_WORK", async () => {
  await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(permissionCalls, ["RADAR_DISCOVERY_ENRICH"]);
});

test("AUTHORIZATION: a denial (NEXT_REDIRECT) propagates untouched, zero further side effects", async () => {
  denyMode = true;
  await assert.rejects(() => enrichDiscoveryResult(VALID_ID), /NEXT_REDIRECT/);
  assert.equal(actorRateLimitCalls.length, 0);
  assert.equal(claimCalls.length, 0);
  assert.equal(configuredProviderCalls, 0);
});

// ---- CALLER IDENTITY ----

test("the actor identity passed to the rate-limit gate and to finalize is ALWAYS the session's own userId, never accepted from the caller", async () => {
  sessionUserId = "real-session-user-id";
  await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(actorRateLimitCalls, ["real-session-user-id"]);
  assert.equal(finalizeCalls[0].actorUserId, "real-session-user-id");
});

// ---- INPUT VALIDATION ----

test("a non-string discoveryResultId is rejected as not_found -- zero downstream calls", async () => {
  const result = await enrichDiscoveryResult(12345);
  assert.deepEqual(result, { status: "not_found" });
  assert.equal(actorRateLimitCalls.length, 0);
  assert.equal(claimCalls.length, 0);
});

test("a syntactically invalid uuid is rejected as not_found, indistinguishable from a genuinely missing row", async () => {
  const result = await enrichDiscoveryResult("not-a-uuid");
  assert.deepEqual(result, { status: "not_found" });
});

test("null/undefined/object discoveryResultId are all rejected as not_found, never thrown", async () => {
  for (const forged of [null, undefined, {}, ["array"], { discoveryResultId: VALID_ID }]) {
    const result = await enrichDiscoveryResult(forged);
    assert.deepEqual(result, { status: "not_found" });
  }
});

test("SECURITY: a poisoned second argument carrying an unexpected fieldSet/provider/userId is never read -- the action's own signature has no slot for it, forceRefresh is the ONLY option field consulted", async () => {
  await enrichDiscoveryResult(VALID_ID, { forceRefresh: false, fieldSet: "details", provider: "attacker_provider", userId: "attacker-id" });
  assert.equal(claimCalls[0].options.forceRefresh, false);
  assert.equal(finalizeCalls[0].actorUserId, "actor-user-1", "userId always the real session, never the poisoned option");
});

// ---- RATE LIMIT (actor level, Enrichment's OWN scope) ----

test("RATE LIMIT: a denied actor-level check blocks BEFORE the claim is ever attempted", async () => {
  actorRateLimitResult = { allowed: false, retryAfterSeconds: 12 };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "actor_rate_limited", retryAfterSeconds: 12 });
  assert.equal(claimCalls.length, 0);
  assert.equal(configuredProviderCalls, 0);
});

// ---- CLAIM outcomes ----

test("CLAIM: not_found -- zero provider calls", async () => {
  claimResult = { status: "not_found" };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "not_found" });
  assert.equal(configuredProviderCalls, 0);
});

test("CLAIM: ignored -- zero provider calls", async () => {
  claimResult = { status: "ignored" };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "ignored" });
  assert.equal(configuredProviderCalls, 0);
});

test("CLAIM: enrichment_in_progress -- zero provider calls, never a second concurrent attempt", async () => {
  claimResult = { status: "enrichment_in_progress" };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "enrichment_in_progress" });
  assert.equal(configuredProviderCalls, 0);
});

test("CLAIM: already_enriched -- surfaces the already-persisted data, zero provider calls", async () => {
  claimResult = { status: "already_enriched", row: { phone: "+1", website: null, openingHours: { periods: [] }, businessStatus: "CLOSED_TEMPORARILY" } };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "already_enriched", discoveryResultId: VALID_ID, phone: "+1", website: null, openingHours: { periods: [] }, businessStatus: "CLOSED_TEMPORARILY" });
  assert.equal(configuredProviderCalls, 0);
});

test("forceRefresh:true is forwarded to the claim call", async () => {
  await enrichDiscoveryResult(VALID_ID, { forceRefresh: true });
  assert.equal(claimCalls[0].options.forceRefresh, true);
});

test("forceRefresh defaults to false when omitted", async () => {
  await enrichDiscoveryResult(VALID_ID);
  assert.equal(claimCalls[0].options.forceRefresh, false);
});

// ---- PROVIDER ----

test("PROVIDER: not configured -> provider_unavailable, and the claim is immediately released (never left held until the lease expires)", async () => {
  providerInstance = null;
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "provider_unavailable" });
  assert.equal(releaseCalls.length, 1);
  assert.equal(releaseCalls[0].id, VALID_ID);
});

test("PROVIDER: configured but lacking the get_details capability -> provider_unavailable, claim released", async () => {
  providerInstance = { id: "google_places", capabilities: () => ["search"], health: () => ({}), search: async () => ({ results: [], nextCursor: null }) };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "provider_unavailable" });
  assert.equal(releaseCalls.length, 1);
});

test("PROVIDER: getDetails() called with the CLAIMED row's own sourceId and the fixed 'details' fieldSet -- never a client-supplied fieldSet", async () => {
  let observedArgs = null;
  providerInstance.getDetails = async (sourceId, fieldSet) => {
    observedArgs = { sourceId, fieldSet };
    return { result: { phone: null, website: null, openingHours: null, businessStatus: null } };
  };
  await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(observedArgs, { sourceId: "ChIJ_place_1", fieldSet: "details" });
});

test("PROVIDER: a thrown PROVIDER_UNAVAILABLE DiscoveryError maps to provider_unavailable, claim released", async () => {
  providerInstance.getDetails = async () => {
    throw { code: "PROVIDER_UNAVAILABLE", providerId: "google_places", retryable: true, message: "x" };
  };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "provider_unavailable" });
  assert.equal(releaseCalls.length, 1);
});

test("PROVIDER: a thrown PROVIDER_RATE_LIMITED DiscoveryError maps to provider_rate_limited, claim released", async () => {
  providerInstance.getDetails = async () => {
    throw { code: "PROVIDER_RATE_LIMITED", providerId: "google_places", retryable: true, message: "x" };
  };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "provider_rate_limited" });
  assert.equal(releaseCalls.length, 1);
});

test("PROVIDER: a thrown QUOTA_EXCEEDED DiscoveryError also maps to provider_rate_limited -- the caller doesn't need to distinguish", async () => {
  providerInstance.getDetails = async () => {
    throw { code: "QUOTA_EXCEEDED", providerId: "google_places", retryable: false, message: "x" };
  };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "provider_rate_limited" });
});

test("PROVIDER: a thrown PROVIDER_TIMEOUT DiscoveryError maps to provider_timeout, claim released", async () => {
  providerInstance.getDetails = async () => {
    throw { code: "PROVIDER_TIMEOUT", providerId: "google_places", retryable: true, message: "x" };
  };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "provider_timeout" });
  assert.equal(releaseCalls.length, 1);
});

test("PROVIDER: a generic thrown PROVIDER_ERROR maps to provider_error, claim released", async () => {
  providerInstance.getDetails = async () => {
    throw { code: "PROVIDER_ERROR", providerId: "google_places", retryable: false, message: "x" };
  };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "provider_error" });
  assert.equal(releaseCalls.length, 1);
});

// ---- FINALIZE ----

test("SUCCESS: a successful getDetails + finalize returns 'enriched' with the actual enrichment data", async () => {
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "enriched", discoveryResultId: VALID_ID, phone: "+33 1 42 00 00 01", website: "https://example.test", openingHours: null, businessStatus: "OPERATIONAL" });
  assert.equal(releaseCalls.length, 0, "a successful finalize must never ALSO release the claim -- finalize itself clears the lease");
});

test("FINALIZE: the provider's result is passed to finalize verbatim, and the claimed row's own claimedAt is passed, never re-derived", async () => {
  await enrichDiscoveryResult(VALID_ID);
  assert.equal(finalizeCalls[0].id, VALID_ID);
  assert.deepEqual(finalizeCalls[0].claimedAt, claimResult.row.enrichmentClaimedAt);
  assert.deepEqual(finalizeCalls[0].patch, { phone: "+33 1 42 00 00 01", website: "https://example.test", openingHours: null, businessStatus: "OPERATIONAL" });
});

test("FINALIZE: lease_lost is treated as a failure (provider_error), never silently reported as success", async () => {
  finalizeResult = { status: "lease_lost" };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.deepEqual(result, { status: "provider_error" });
});

// ---- SECURITY: no secret / CRM leakage ----

test("SECURITY: the full action result never contains any string resembling an API key", async () => {
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.ok(!JSON.stringify(result).match(/AIza|api[_-]?key/i));
});

test("SECURITY: a provider failure's action result carries only a closed-set status, never the raw thrown object/message", async () => {
  providerInstance.getDetails = async () => {
    throw { code: "PROVIDER_ERROR", providerId: "google_places", retryable: false, message: "raw google detail with sk-LEAK-secret" };
  };
  const result = await enrichDiscoveryResult(VALID_ID);
  assert.ok(!JSON.stringify(result).includes("sk-LEAK-secret"));
  assert.deepEqual(Object.keys(result), ["status"]);
});

test("SECURITY: this module never imports lib/crm-client-access or lib/crm-client-dedup -- Discovery staging and CRM visibility remain structurally separate (a call without an import could never run)", async () => {
  const source = await import("node:fs/promises").then((fs) => fs.readFile(new URL("./radar-discovery-enrich.ts", import.meta.url), "utf8"));
  assert.ok(!source.includes('from "@/lib/crm-client-access"'), "must never import the CRM visibility module");
  assert.ok(!source.includes('from "@/lib/crm-client-dedup"'), "must never import the CRM dedup module");
});
