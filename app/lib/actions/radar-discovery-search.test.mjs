// RADAR DISCOVERY ENGINE — Phase C-2A — radar-discovery-search.ts server
// action unit tests. Every collaborator is mocked at the module boundary
// (same convention as lib/actions/radar-intelligence.test.mjs) — no real
// DB, no real Google call. validateDiscoverySearchRequest() (C-0) is
// deliberately LEFT REAL (pure, already unit-tested on its own) so these
// tests prove genuine integration with it, not a re-mock of its own
// logic.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/radar-discovery-search.test.mjs
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

// ---- actor rate limit ----
let actorRateLimitCalls = [];
let actorRateLimitResult = { allowed: true };
mock.module("@/lib/radar-discovery/actor-rate-limit", {
  namedExports: {
    checkDiscoveryActorRateLimit: async (userId) => {
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

// ---- CRM dedup ----
let crmMatchCalls = [];
let crmMatchResult = { outcome: "NO_MATCH" };
mock.module("@/lib/crm-client-dedup", {
  namedExports: {
    findCrmClientMatch: async (input) => {
      crmMatchCalls.push(input);
      return crmMatchResult;
    },
  },
});

// ---- discovery-result-store ----
// MISSION C-2C-1.5 — fakeRow() mirrors the REAL store's own behavior
// (createDiscoveryResult() always returns a row carrying exactly the
// fields it was given, plus id/status/crmClientId) so these unit tests
// exercise the same category/address/country/region/city/latitude/
// longitude widening the real store would actually produce.
function fakeRow(input, overrides = {}) {
  return {
    id: "drow-1",
    source: input.source,
    sourceId: input.sourceId,
    name: input.name,
    category: input.category ?? null,
    address: input.address ?? null,
    country: input.country ?? null,
    region: input.region ?? null,
    city: input.city ?? null,
    latitude: input.latitude ?? null,
    longitude: input.longitude ?? null,
    status: "discovered",
    crmClientId: null,
    ...overrides,
  };
}
let createDiscoveryResultCalls = [];
let createDiscoveryResultImpl = async (input) => ({
  result: fakeRow(input),
  created: true,
});
mock.module("@/lib/radar-discovery/discovery-result-store", {
  namedExports: {
    createDiscoveryResult: async (input) => {
      createDiscoveryResultCalls.push(input);
      return createDiscoveryResultImpl(input);
    },
  },
});

const { searchRadarDiscovery } = await import("./radar-discovery-search.ts");

const VALID_REQUEST = { category: "restaurants", city: "Montreal", maxResults: 5, fieldSet: "minimal_discovery" };

function fakePlace(overrides = {}) {
  return {
    source: "google_places",
    sourceId: "ChIJ_place_1",
    sourceUrl: "https://maps.google.com/?cid=1",
    name: "Test Place",
    category: "restaurant",
    address: "1 Main St",
    country: "Canada",
    region: "Quebec",
    city: "Montreal",
    postalCode: "H1H 1H1",
    phone: null,
    email: null,
    website: null,
    latitude: 45.5,
    longitude: -73.5,
    timezone: "America/Montreal",
    openingHours: null,
    ...overrides,
  };
}

function reset() {
  permissionCalls = [];
  denyMode = false;
  sessionUserId = "actor-user-1";
  actorRateLimitCalls = [];
  actorRateLimitResult = { allowed: true };
  configuredProviderCalls = 0;
  providerInstance = {
    id: "google_places",
    capabilities: () => ["search"],
    health: () => ({ id: "google_places", state: "connected", capabilities: ["search"], lastCheckedAt: null }),
    search: async () => ({ results: [fakePlace()], nextCursor: null }),
  };
  crmMatchCalls = [];
  crmMatchResult = { outcome: "NO_MATCH" };
  createDiscoveryResultCalls = [];
  createDiscoveryResultImpl = async (input) => ({
    result: fakeRow(input),
    created: true,
  });
}
test.beforeEach(reset);

// ---- AUTHORIZATION ----

test("AUTHORIZATION: requireRadarAccess('RADAR_QUEUE_VIEW') runs first, before any other side effect", async () => {
  await searchRadarDiscovery(VALID_REQUEST);
  assert.deepEqual(permissionCalls, ["RADAR_QUEUE_VIEW"]);
});

test("AUTHORIZATION: OWNER/ADMIN/MANAGER/EMPLOYEE (radar_access=true) all pass -- requireRadarAccess itself is the single source of truth, this action adds no role branching of its own", async () => {
  // requireRadarAccess's own role matrix is tested exhaustively in
  // lib/rbac/require-staff-member.test.mjs -- this action never
  // re-implements role logic, it only calls that gate once.
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.status, "ok");
});

test("AUTHORIZATION: CLIENT / radar_access=false -> the redirect propagates untouched, zero further side effects", async () => {
  denyMode = true;
  await assert.rejects(() => searchRadarDiscovery(VALID_REQUEST), /NEXT_REDIRECT/);
  assert.equal(actorRateLimitCalls.length, 0);
  assert.equal(configuredProviderCalls, 0);
  assert.equal(crmMatchCalls.length, 0);
  assert.equal(createDiscoveryResultCalls.length, 0);
});

// ---- CALLER IDENTITY ----

test("the actor identity passed to the rate-limit gate is ALWAYS the session's own userId, never accepted from the request payload", async () => {
  sessionUserId = "real-session-user-id";
  await searchRadarDiscovery({ ...VALID_REQUEST, userId: "attacker-supplied-id" });
  assert.deepEqual(actorRateLimitCalls, ["real-session-user-id"]);
});

// ---- REQUEST VALIDATION ----

test("REQUEST: a valid request proceeds to the provider", async () => {
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.status, "ok");
});

test("REQUEST: an invalid request (missing maxResults/fieldSet) is rejected -- ZERO downstream calls", async () => {
  const result = await searchRadarDiscovery({ category: "restaurants" });
  assert.equal(result.status, "invalid_request");
  assert.equal(typeof result.reason, "string");
  assert.equal(actorRateLimitCalls.length, 0, "an invalid request must never spend a rate-limit unit");
  assert.equal(configuredProviderCalls, 0, "an invalid request must never reach the provider");
});

test("REQUEST: a completely empty/malformed payload (e.g. a string) is rejected, never throws", async () => {
  const result = await searchRadarDiscovery("not an object");
  assert.equal(result.status, "invalid_request");
});

// ---- RATE LIMIT (actor level) ----

test("RATE LIMIT: a denied actor-level check blocks the search BEFORE the provider is ever configured/called", async () => {
  actorRateLimitResult = { allowed: false, retryAfterSeconds: 37 };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.deepEqual(result, { status: "actor_rate_limited", retryAfterSeconds: 37 });
  assert.equal(configuredProviderCalls, 0);
});

// ---- PROVIDER ----

test("PROVIDER: provider not configured (null) -> provider_unavailable, no crash", async () => {
  providerInstance = null;
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.deepEqual(result, { status: "provider_unavailable" });
});

test("PROVIDER: a thrown PROVIDER_UNAVAILABLE DiscoveryError maps to provider_unavailable", async () => {
  providerInstance.search = async () => {
    throw { code: "PROVIDER_UNAVAILABLE", providerId: "google_places", retryable: true, message: "x" };
  };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.deepEqual(result, { status: "provider_unavailable" });
});

test("PROVIDER: a thrown PROVIDER_RATE_LIMITED DiscoveryError maps to provider_rate_limited", async () => {
  providerInstance.search = async () => {
    throw { code: "PROVIDER_RATE_LIMITED", providerId: "google_places", retryable: true, message: "x" };
  };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.deepEqual(result, { status: "provider_rate_limited" });
});

test("PROVIDER: a thrown QUOTA_EXCEEDED DiscoveryError (C-1's own internal guard) ALSO maps to provider_rate_limited -- the caller doesn't need to distinguish", async () => {
  providerInstance.search = async () => {
    throw { code: "QUOTA_EXCEEDED", providerId: "google_places", retryable: false, message: "x" };
  };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.deepEqual(result, { status: "provider_rate_limited" });
});

test("PROVIDER: a thrown PROVIDER_TIMEOUT DiscoveryError maps to provider_timeout", async () => {
  providerInstance.search = async () => {
    throw { code: "PROVIDER_TIMEOUT", providerId: "google_places", retryable: true, message: "x" };
  };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.deepEqual(result, { status: "provider_timeout" });
});

test("PROVIDER: a generic thrown PROVIDER_ERROR maps to provider_error", async () => {
  providerInstance.search = async () => {
    throw { code: "PROVIDER_ERROR", providerId: "google_places", retryable: false, message: "x" };
  };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.deepEqual(result, { status: "provider_error" });
});

test("PROVIDER: nextCursor is relayed verbatim from the provider outcome", async () => {
  providerInstance.search = async () => ({ results: [], nextCursor: "opaque-token" });
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.nextCursor, "opaque-token");
});

// ---- DEDUP ----

test("DEDUP: a NO_MATCH result is created as a new discovery result", async () => {
  crmMatchResult = { outcome: "NO_MATCH" };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].status, "created");
  assert.equal(result.createdCount, 1);
  assert.equal(createDiscoveryResultCalls.length, 1);
});

test("DEDUP: an EXACT_MATCH result is NEVER persisted to discovery_results -- reported as already_in_crm instead", async () => {
  crmMatchResult = { outcome: "EXACT_MATCH", clientId: "hidden-crm-client-id", matchedSignals: ["email"], confidence: "HIGH", reason: "x" };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].status, "already_in_crm");
  assert.equal(result.alreadyInCrmCount, 1);
  assert.equal(createDiscoveryResultCalls.length, 0);
});

test("DEDUP: NO CRM-internal field (clientId, matchedSignals, confidence, candidateClientIds) ever leaks into the already_in_crm item", async () => {
  crmMatchResult = { outcome: "EXACT_MATCH", clientId: "SECRET-HIDDEN-CLIENT-ID", matchedSignals: ["email", "phone"], confidence: "HIGH", reason: "internal reasoning text" };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("SECRET-HIDDEN-CLIENT-ID"));
  assert.ok(!serialized.includes("matchedSignals"));
  assert.ok(!serialized.includes("confidence"));
  assert.ok(!serialized.includes("internal reasoning text"));
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["name", "source", "sourceId", "status"].sort());
});

test("DEDUP: an AMBIGUOUS_MATCH result is STILL created (never blocked, never leaked) -- ambiguity is never treated as a confirmed duplicate", async () => {
  crmMatchResult = { outcome: "AMBIGUOUS_MATCH", candidateClientIds: ["hidden-1", "hidden-2"], matchedSignals: ["name_location"], confidence: "MEDIUM", reason: "x" };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].status, "created");
  assert.equal(createDiscoveryResultCalls.length, 1);
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("hidden-1"));
  assert.ok(!serialized.includes("hidden-2"));
});

test("DEDUP: findCrmClientMatch is called with the discovered fields, never a client-supplied override", async () => {
  await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(crmMatchCalls[0].name, "Test Place");
  assert.equal(crmMatchCalls[0].city, "Montreal");
});

// ---- PERSISTENCE ----

test("PERSISTENCE: a newly created discovery result reports status=discovered (via the store's own row) -- no status/crmClientId settable from this action", async () => {
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].status, "created");
  assert.ok(!("crmClientId" in createDiscoveryResultCalls[0]));
  assert.ok(!("status" in createDiscoveryResultCalls[0]));
});

test("PERSISTENCE: an already-discovered result (created=false) is reported as already_discovered", async () => {
  createDiscoveryResultImpl = async (input) => ({
    result: fakeRow(input, { id: "existing-row" }),
    created: false,
  });
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].status, "already_discovered");
  assert.equal(result.alreadyDiscoveredCount, 1);
});

// ---- MISSION C-2C-1.5 — result contract widening ----

test("C-2C-1.5: a 'created' item exposes category/address/country/region/city/latitude/longitude straight from the stored row -- no extra query, same values as the store's own return", async () => {
  createDiscoveryResultImpl = async (input) => ({
    result: fakeRow(input, {
      category: "restaurant",
      address: "1 Main St",
      country: "Canada",
      region: "Quebec",
      city: "Montreal",
      latitude: 45.5,
      longitude: -73.5,
    }),
    created: true,
  });
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].status, "created");
  assert.deepEqual(result.items[0], {
    status: "created",
    source: "google_places",
    sourceId: "ChIJ_place_1",
    name: "Test Place",
    discoveryResultId: "drow-1",
    category: "restaurant",
    address: "1 Main St",
    country: "Canada",
    region: "Quebec",
    city: "Montreal",
    latitude: 45.5,
    longitude: -73.5,
  });
});

test("C-2C-1.5: an 'already_discovered' item exposes the SAME widened fields as 'created'", async () => {
  createDiscoveryResultImpl = async (input) => ({
    result: fakeRow(input, { id: "existing-row", category: "restaurant", address: "1 Main St", country: "Canada", region: "Quebec", city: "Montreal", latitude: 45.5, longitude: -73.5 }),
    created: false,
  });
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].status, "already_discovered");
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["address", "category", "city", "country", "discoveryResultId", "latitude", "longitude", "name", "region", "source", "sourceId", "status"].sort());
  assert.equal(result.items[0].category, "restaurant");
  assert.equal(result.items[0].address, "1 Main St");
  assert.equal(result.items[0].country, "Canada");
  assert.equal(result.items[0].region, "Quebec");
  assert.equal(result.items[0].city, "Montreal");
  assert.equal(result.items[0].latitude, 45.5);
  assert.equal(result.items[0].longitude, -73.5);
});

test("C-2C-1.5: null fields on the stored row (e.g. no category/coordinates known) come through as null, never undefined or a fabricated value", async () => {
  providerInstance.search = async () => ({
    results: [fakePlace({ category: null, address: null, country: null, region: null, city: null, latitude: null, longitude: null })],
    nextCursor: null,
  });
  createDiscoveryResultImpl = async (input) => ({ result: fakeRow(input), created: true });
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].category, null);
  assert.equal(result.items[0].address, null);
  assert.equal(result.items[0].country, null);
  assert.equal(result.items[0].region, null);
  assert.equal(result.items[0].city, null);
  assert.equal(result.items[0].latitude, null);
  assert.equal(result.items[0].longitude, null);
});

test("C-2C-1.5 NON-REGRESSION: widening created/already_discovered NEVER widens already_in_crm -- its shape stays EXACTLY name/source/sourceId/status", async () => {
  crmMatchResult = { outcome: "EXACT_MATCH", clientId: "hidden-crm-client-id", matchedSignals: ["email"], confidence: "HIGH", reason: "x" };
  // Even if the provider result itself carries a full address/category/
  // coordinates set, already_in_crm must still never read or forward any
  // of it -- that branch returns before createDiscoveryResult() is ever
  // called, so there is no row to widen from even in principle.
  providerInstance.search = async () => ({
    results: [fakePlace({ category: "restaurant", address: "1 Main St", country: "Canada", region: "Quebec", city: "Montreal", latitude: 45.5, longitude: -73.5 })],
    nextCursor: null,
  });
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items[0].status, "already_in_crm");
  assert.deepEqual(Object.keys(result.items[0]).sort(), ["name", "source", "sourceId", "status"].sort());
  assert.equal(createDiscoveryResultCalls.length, 0, "already_in_crm never reaches the store at all -- confirms there is no row available to widen from");
  const serialized = JSON.stringify(result);
  assert.ok(!serialized.includes("restaurant"));
  assert.ok(!serialized.includes("Main St"));
  assert.ok(!serialized.includes("45.5"));
});

test("PERSISTENCE: multiple provider results each go through dedup+persistence independently", async () => {
  providerInstance.search = async () => ({ results: [fakePlace({ sourceId: "place-1" }), fakePlace({ sourceId: "place-2" })], nextCursor: null });
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.equal(result.items.length, 2);
  assert.equal(createDiscoveryResultCalls.length, 2);
});

// ---- SECURITY: no secret leakage ----

test("SECURITY: the full action result never contains any string resembling an API key", async () => {
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.ok(!JSON.stringify(result).match(/AIza|api[_-]?key/i));
});

test("SECURITY: a provider failure's action result carries only a closed-set status, never the raw thrown object/message", async () => {
  providerInstance.search = async () => {
    throw { code: "PROVIDER_ERROR", providerId: "google_places", retryable: false, message: "raw google detail with sk-LEAK-secret" };
  };
  const result = await searchRadarDiscovery(VALID_REQUEST);
  assert.ok(!JSON.stringify(result).includes("sk-LEAK-secret"));
  assert.deepEqual(Object.keys(result), ["status"]);
});
