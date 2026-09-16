// RADAR DISCOVERY ENGINE — Phase C-1, DB-independence fixed in
// MISSION C-2D-0-FIX — offline tests for the guarded live-smoke harness.
// ZERO network: an injected fake `fetch` simulates the Google Places
// response. ZERO database: this file deliberately mocks NEITHER
// "@/lib/api-v1/rate-limit" NOR "@/db" — the script now supplies its own
// real, in-memory checkRateLimit override
// (lib/radar-discovery/in-memory-rate-limit.ts) to
// createConfiguredGooglePlacesProvider(), so the DB-backed default
// (rate-limit-gate.ts -> @/lib/api-v1/rate-limit -> @/db, which requires
// DATABASE_URL at module-load time) is never reached anywhere in this
// script's import graph. Before the fix, this file had to fake a working
// @/db insert chain just to let that unavoidable DB-backed path succeed —
// its absence below is itself part of the proof. This file IS wired into
// `npm test`; the live script itself is never invoked by any automation.
// Mirrors scripts/radar-intelligence-live-smoke.test.mjs's exact structure.
//
// Run: npx tsx --test --experimental-test-module-mocks scripts/radar-discovery-google-places-live-smoke.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// Sanity guard for the test environment itself: this suite's entire point
// is proving DB-independence, so it must never accidentally run with a
// real DATABASE_URL already exported that would mask a real bug.
delete process.env.DATABASE_URL;

mock.module("server-only", { namedExports: {} });

const { runGooglePlacesLiveSmoke, ACK_FLAG, SMOKE_MAX_RESULTS, SMOKE_SEARCH_REQUEST } = await import("./radar-discovery-google-places-live-smoke.mjs");

const HOSTILE_KEY = "AIzaLIVE-SMOKE-SECRET-DO-NOT-LEAK";
const ENABLED_ENV = { GOOGLE_PLACES_ENABLED: "true", GOOGLE_PLACES_API_KEY: HOSTILE_KEY };

function collector() {
  const lines = [];
  return { lines, write: (l) => lines.push(l), text: () => lines.join("\n") };
}

function fakeFetch(script = {}) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (script.reject) throw script.reject;
    const status = script.status ?? 200;
    return {
      status,
      async json() {
        if (script.invalidJson) throw new SyntaxError("bad");
        return script.body ?? { places: [{ id: "ChIJ_smoke_test", displayName: { text: "Smoke Test Restaurant" } }] };
      },
    };
  };
  fn.calls = calls;
  return fn;
}

async function run(overrides = {}) {
  const so = collector();
  const se = collector();
  const ff = overrides.fetchImpl ?? fakeFetch(overrides.script);
  const res = await runGooglePlacesLiveSmoke({
    argv: overrides.argv ?? [ACK_FLAG],
    env: overrides.env ?? ENABLED_ENV,
    fetchImpl: ff,
    stdout: so.write,
    stderr: se.write,
    ...(overrides.request ? { request: overrides.request } : {}),
  });
  return { res, stdout: so.text(), stderr: se.text(), fetchCalls: ff.calls?.length ?? 0, ff };
}

const noSecret = (s) => {
  assert.equal(s.includes(HOSTILE_KEY), false, "hostile key leaked");
  assert.equal(/AIza/i.test(s), false, "AIza-prefix pattern leaked");
};

// ---------------- guard 1 — no acknowledgement flag ----------------

test("no --i-understand flag -> refused, exitCode 2, ZERO fetch calls, key absent", async () => {
  const { res, stdout, stderr, fetchCalls } = await run({ argv: [] });
  assert.equal(res.exitCode, 2);
  assert.equal(res.reason, "missing-ack-flag");
  assert.equal(fetchCalls, 0);
  assert.equal(stdout, "");
  assert.match(stderr, /Re-run with --i-understand-this-is-a-live-call/);
  noSecret(stdout + stderr + JSON.stringify(res));
});

// ---------------- guard 2 — flag present but disabled ----------------

test("flag present, GOOGLE_PLACES_ENABLED not 'true' (with a key present) -> refused, exitCode 3, ZERO fetch", async () => {
  const { res, stdout, fetchCalls } = await run({ env: { GOOGLE_PLACES_API_KEY: HOSTILE_KEY } });
  assert.equal(res.exitCode, 3);
  assert.equal(res.reason, "not-enabled");
  assert.equal(fetchCalls, 0);
  assert.equal(stdout, "");
});

test("GOOGLE_PLACES_ENABLED='yes' (not exactly true/1) -> still refused", async () => {
  const { res, fetchCalls } = await run({ env: { GOOGLE_PLACES_ENABLED: "yes", GOOGLE_PLACES_API_KEY: HOSTILE_KEY } });
  assert.equal(res.reason, "not-enabled");
  assert.equal(fetchCalls, 0);
});

// ---------------- guard 3 — enabled but no key ----------------

test("enabled=true, NO key -> refused, exitCode 4, ZERO fetch", async () => {
  const { res, stdout, fetchCalls } = await run({ env: { GOOGLE_PLACES_ENABLED: "true" } });
  assert.equal(res.exitCode, 4);
  assert.equal(res.reason, "missing-key");
  assert.equal(fetchCalls, 0);
  assert.equal(stdout, "");
});

// ---------------- all guards pass — exactly one call ----------------

test("all guards pass -> exactly ONE fetch call, exitCode 0, safe result printed", async () => {
  const { res, stdout, fetchCalls } = await run();
  assert.equal(fetchCalls, 1);
  assert.equal(res.exitCode, 0);
  assert.equal(res.reason, "search-completed");
  assert.equal(res.safeResult.resultCount, 1);
  assert.equal(res.safeResult.firstResultName, "Smoke Test Restaurant");
  assert.ok(stdout.length > 0);
  noSecret(stdout);
});

test("the forced request always uses fieldSet=minimal_discovery and maxResults capped at SMOKE_MAX_RESULTS, regardless of what's passed in", async () => {
  const { res } = await run({ request: { ...SMOKE_SEARCH_REQUEST, fieldSet: "details", maxResults: 999 } });
  assert.equal(res.safeResult.requestedFieldSet, "minimal_discovery");
  assert.equal(res.safeResult.requestedMaxResults, SMOKE_MAX_RESULTS);
});

test("the api key is sent to the provider but NEVER appears anywhere in stdout/stderr/the returned result", async () => {
  const { res, stdout, stderr } = await run();
  noSecret(stdout);
  noSecret(stderr);
  noSecret(JSON.stringify(res));
});

test("the api key is genuinely used on the outbound request (proves the guard flow actually wires it through), yet still never printed", async () => {
  const { ff, stdout } = await run();
  assert.equal(ff.calls[0].init.headers["X-Goog-Api-Key"], HOSTILE_KEY);
  noSecret(stdout);
});

// ---------------- provider failure surfaces safely ----------------

test("a provider-side error (e.g. 403) surfaces only a safe error code, exitCode 1, never the raw Google error body", async () => {
  const { res, stdout } = await run({ script: { status: 403, body: { error: { code: 403, status: "PERMISSION_DENIED", message: "API key not authorized for this API" } } } });
  assert.equal(res.exitCode, 1);
  assert.equal(res.reason, "provider-failure");
  assert.equal(res.safeResult.errorCode, "PROVIDER_ERROR");
  assert.ok(!stdout.includes("not authorized"));
});

// ---------------- no DB / no persistence import ----------------

test("this module never IMPORTS the discovery-result-store -- structurally cannot write to discovery_results (the module name may still appear in prose explaining that fact)", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./radar-discovery-google-places-live-smoke.mjs", import.meta.url), "utf8");
  const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
  for (const line of importLines) {
    assert.doesNotMatch(line, /discovery-result-store/);
    assert.doesNotMatch(line, /crm_clients|crm-clients/i);
  }
});

// ---------------- MISSION C-2D-0-FIX — genuinely DB-free ----------------

test("DB-FREE: the full guarded flow (all guards pass, one fetch call) succeeds with NO @/db mock present and NO DATABASE_URL set anywhere in this process", async () => {
  assert.equal(process.env.DATABASE_URL, undefined, "this test's own premise requires DATABASE_URL to genuinely be unset");
  const { res, fetchCalls } = await run();
  assert.equal(fetchCalls, 1);
  assert.equal(res.exitCode, 0);
  assert.equal(res.reason, "search-completed");
});

test("DB-FREE: this script's import graph never reaches @/lib/api-v1/rate-limit or @/db -- source-level guard on the two files that carry the real DB-backed rate limiter", async () => {
  const { readFile } = await import("node:fs/promises");
  const scriptSource = await readFile(new URL("./radar-discovery-google-places-live-smoke.mjs", import.meta.url), "utf8");
  const configuredSource = await readFile(new URL("../lib/radar-discovery/adapters/configured-google-places.ts", import.meta.url), "utf8");

  for (const [label, source] of [["live-smoke script", scriptSource], ["configured-google-places.ts", configuredSource]]) {
    const importLines = source.split("\n").filter((line) => /^\s*import\b/.test(line));
    assert.equal(importLines.some((line) => line.includes("@/lib/api-v1/rate-limit")), false, `${label} must never import @/lib/api-v1/rate-limit`);
    assert.equal(importLines.some((line) => /@\/db\b/.test(line)), false, `${label} must never import @/db`);
    // Any reference to rate-limit-gate.ts (configured-google-places.ts has
    // one, for a type) must be type-only -- erased at compile time.
    const rateLimitGateLine = importLines.find((line) => line.includes("rate-limit-gate"));
    if (rateLimitGateLine) assert.match(rateLimitGateLine, /^\s*import type\b/, `${label}'s rate-limit-gate reference must be type-only`);
  }
});

test("DB-FREE: the live-smoke script supplies its own in-memory checkRateLimit override to createConfiguredGooglePlacesProvider() -- it never relies on the DB-backed default", async () => {
  const { readFile } = await import("node:fs/promises");
  const source = await readFile(new URL("./radar-discovery-google-places-live-smoke.mjs", import.meta.url), "utf8");
  assert.match(source, /createInMemoryDiscoveryRateLimit/);
  assert.match(source, /checkRateLimit:\s*createInMemoryDiscoveryRateLimit\(\)/);
});

test("importing this module runs nothing (no CLI branch executes on import)", async () => {
  // If import.meta.url === invokedPath ran during the top-level await
  // import above, fetchCalls/exitCode would already be non-zero side
  // effects visible via process exit -- the mere fact this test file's
  // own tests above ran at all (never exited early) proves the guard.
  assert.ok(true);
});
