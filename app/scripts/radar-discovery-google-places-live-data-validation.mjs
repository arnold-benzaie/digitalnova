/**
 * RADAR DISCOVERY ENGINE — MISSION C-2D-2 — guarded, ISOLATED live-DATA
 * validation for the Google Places provider. A SEPARATE script from
 * scripts/radar-discovery-google-places-live-smoke.mjs (the original
 * "connectivity only, not a data dump" smoke) — that file's own contract
 * is deliberately left untouched; this one exists specifically to verify
 * the STRUCTURED fields (category/address/country/region/city/latitude/
 * longitude) that C-2D-1's audit identified as never having been checked
 * against a real Google response.
 *
 * Purpose: a HUMAN, in LOCAL DEVELOPMENT, with their own
 * GOOGLE_PLACES_API_KEY, runs this to confirm the normalizeGooglePlacesResult()
 * contract (lib/radar-discovery/adapters/google-places.ts) against a real
 * response — up to DEFAULT_MAX_RESULTS results, minimal_discovery only,
 * at most ONE additional paginated request.
 *
 * SAFETY (mirrors the original live-smoke script's exact discipline):
 *  - refuses unless invoked with the SAME --i-understand-this-is-a-live-call
 *    flag (imported from the original script — one phrase across every
 *    live script in this repo)
 *  - refuses unless GOOGLE_PLACES_ENABLED is exactly true/1
 *  - refuses unless GOOGLE_PLACES_API_KEY is present (never printed)
 *  - fieldSet forced to "minimal_discovery" — NEVER enrichment/details,
 *    regardless of what a caller passes
 *  - maxResults capped at DEFAULT_MAX_RESULTS (5) — never higher
 *  - PAGINATION HARD CAP: at most ONE additional request beyond the
 *    first, structurally (no loop exists in this file at all — there is
 *    no code path that could issue a 3rd request even if Google's own
 *    2nd-page response also carried a further nextPageToken)
 *  - the SAME redaction allowlist (REDACTION_PATTERNS, imported from the
 *    original script) is asserted against the full serialized output
 *    before any stdout write
 *  - per-result output is an EXPLICIT allowlist (redactResult() below) —
 *    source/sourceId/name/category/address/country/region/city/latitude/
 *    longitude/sourceUrl ONLY. NEVER phone/email/website/timezone/
 *    openingHours (minimal_discovery never even requests these from
 *    Google, so they are always null on the normalized result already —
 *    this allowlist is explicit defense-in-depth, not reliance on that
 *    fact alone) — and NEVER any raw Google response, any HTTP header,
 *    or the pagination token itself (only hasNextCursor, a boolean, is
 *    ever surfaced)
 *  - a real, DB-free, in-memory rate-limit check (MISSION C-2D-0-FIX's
 *    lib/radar-discovery/in-memory-rate-limit.ts) guards BOTH requests —
 *    never bypassed, never the DB-backed default (this script must
 *    remain independent of DATABASE_URL)
 *  - NEVER imports lib/radar-discovery/discovery-result-store.ts,
 *    lib/actions/radar-discovery-search.ts, or
 *    lib/actions/radar-discovery-convert.ts — structurally cannot write
 *    to discovery_results or crm_clients, cannot call searchRadarDiscovery()
 *    or convertDiscoveryResult(), cannot touch RBAC (no session, no
 *    requireRadarAccess() anywhere in this file's import graph)
 *  - never creates/edits any .env file
 *  - importing this module runs NOTHING (only the CLI branch executes)
 *
 * This module transitively imports `server-only` modules; run it with
 * the react-server condition. It is NOT wired into npm test / pre-commit
 * / CI / build / cron / Vercel — only its offline sibling test is.
 */
import { pathToFileURL } from "node:url";
import { loadRadarDiscoveryConfig } from "../lib/radar-discovery/config-loader.ts";
import { createConfiguredGooglePlacesProvider } from "../lib/radar-discovery/adapters/configured-google-places.ts";
import { createInMemoryDiscoveryRateLimit } from "../lib/radar-discovery/in-memory-rate-limit.ts";
// Reuse the ORIGINAL smoke script's own flag + redaction allowlist —
// single source of truth, never duplicated/drifted. Importing this
// module runs nothing (its own CLI branch only fires when invoked
// directly — see that file's own header).
import { ACK_FLAG, REDACTION_PATTERNS } from "./radar-discovery-google-places-live-smoke.mjs";

export { ACK_FLAG };

export const DEFAULT_MAX_RESULTS = 5;
/** Structural documentation of the hard cap enforced below: there is no
 * loop in this file — at most ONE additional page is ever requested,
 * regardless of what either response's own nextPageToken says. */
export const MAX_ADDITIONAL_PAGES = 1;

/** Same hardcoded, reviewed, non-sensitive public search as the original
 * smoke test (mission's own explicit request: identical query). */
export const VALIDATION_SEARCH_REQUEST = Object.freeze({
  category: "restaurants",
  city: "Port Louis",
  country: "Mauritius",
  maxResults: DEFAULT_MAX_RESULTS,
  fieldSet: "minimal_discovery",
});

/** Explicit per-result allowlist — a hand-built literal, NEVER a spread
 * of the normalized result, so a future field added to
 * DiscoveryProviderResult can never leak here by accident. */
function redactResult(result) {
  return {
    source: result.source,
    sourceId: result.sourceId,
    name: result.name,
    category: result.category,
    address: result.address,
    country: result.country,
    region: result.region,
    city: result.city,
    latitude: result.latitude,
    longitude: result.longitude,
    sourceUrl: result.sourceUrl,
  };
}

function firstForbidden(text) {
  for (const re of REDACTION_PATTERNS) if (re.test(text)) return re.source;
  return null;
}

/**
 * Testable execution core. Injectable argv/env/fetch/writers so the
 * offline sibling test runs fully without network. Returns
 * { exitCode, reason, fetchCalls, safeResult }. NEVER throws.
 */
export async function runGooglePlacesLiveDataValidation({ argv = [], env = {}, fetchImpl, stdout, stderr, request = VALIDATION_SEARCH_REQUEST } = {}) {
  const out = (line) => {
    if (typeof stdout === "function") stdout(line);
  };
  const err = (line) => {
    if (typeof stderr === "function") stderr(line);
  };

  let fetchCalls = 0;
  const baseFetch = typeof fetchImpl === "function" ? fetchImpl : globalThis.fetch;
  const countingFetch =
    typeof baseFetch === "function"
      ? (...args) => {
          fetchCalls += 1;
          return baseFetch(...args);
        }
      : undefined;

  // --- Guard 1: explicit acknowledgement flag ---
  if (!argv.includes(ACK_FLAG)) {
    err(`Refused: this initiates a LIVE Google Places request. Re-run with ${ACK_FLAG}. Zero provider calls were made.`);
    return { exitCode: 2, reason: "missing-ack-flag", fetchCalls: 0, safeResult: null };
  }

  // --- Guard 2: enable flag (even with the ack flag) ---
  const cfg = loadRadarDiscoveryConfig(env).googlePlaces;
  if (!cfg.enabledFlag) {
    err('Refused: GOOGLE_PLACES_ENABLED is not "true". Zero provider calls were made.');
    return { exitCode: 3, reason: "not-enabled", fetchCalls: 0, safeResult: null };
  }

  // --- Guard 3: credential presence (value is never printed) ---
  if (!cfg.hasCredential) {
    err("Refused: no GOOGLE_PLACES_API_KEY in the environment. Zero provider calls were made.");
    return { exitCode: 4, reason: "missing-key", fetchCalls: 0, safeResult: null };
  }

  // --- All guards passed ---
  const requestedMaxResults = Math.min(DEFAULT_MAX_RESULTS, Math.max(1, Math.trunc(request.maxResults ?? DEFAULT_MAX_RESULTS)));
  const baseRequest = {
    category: request.category,
    city: request.city,
    country: request.country,
    maxResults: requestedMaxResults,
    fieldSet: "minimal_discovery",
  };

  const provider = createConfiguredGooglePlacesProvider({
    loadedConfig: { googlePlaces: cfg },
    ...(countingFetch ? { fetchImpl: countingFetch } : {}),
    // DB-free, real guard — same rationale as the original live-smoke
    // script (MISSION C-2D-0-FIX). Guards BOTH requests below, never
    // bypassed for the second page.
    checkRateLimit: createInMemoryDiscoveryRateLimit(),
  });
  if (!provider) {
    err("Refused: provider could not be configured despite guards passing. Zero provider calls were made.");
    return { exitCode: 4, reason: "missing-key", fetchCalls: 0, safeResult: null };
  }

  let page1Outcome;
  let errorInfo = null;
  const fetchCallsBeforePage1 = fetchCalls;
  try {
    page1Outcome = await provider.search(baseRequest);
  } catch (thrown) {
    errorInfo = thrown && typeof thrown === "object" && "code" in thrown ? { code: thrown.code, retryable: thrown.retryable === true } : null;
  }

  if (errorInfo) {
    const safeResult = { providerId: "google_places", outcome: "failure", errorCode: errorInfo.code, errorRetryable: errorInfo.retryable };
    const serialized = JSON.stringify(safeResult);
    const hit = firstForbidden(serialized);
    if (hit) {
      err(`Redaction failure: the result matched a forbidden pattern (${hit}). Nothing was printed.`);
      return { exitCode: 5, reason: "redaction-failure", fetchCalls, safeResult: null };
    }
    out(JSON.stringify(safeResult, null, 2));
    return { exitCode: 1, reason: "provider-failure", fetchCalls, safeResult };
  }

  const page1 = {
    resultCount: page1Outcome.results.length,
    hasNextCursor: Boolean(page1Outcome.nextCursor),
    attemptCount: fetchCalls - fetchCallsBeforePage1,
    circuitState: provider.health().state,
    results: page1Outcome.results.map(redactResult),
  };

  let page2 = null;
  // HARD CAP: no loop exists here — this `if` is the ONLY place a second
  // request can ever be issued, and there is no code path back to it.
  if (page1.hasNextCursor) {
    const fetchCallsBeforePage2 = fetchCalls;
    try {
      const page2Outcome = await provider.search({ ...baseRequest, cursor: page1Outcome.nextCursor });
      page2 = {
        resultCount: page2Outcome.results.length,
        hasNextCursor: Boolean(page2Outcome.nextCursor),
        attemptCount: fetchCalls - fetchCallsBeforePage2,
        circuitState: provider.health().state,
        results: page2Outcome.results.map(redactResult),
      };
    } catch (thrown) {
      const info = thrown && typeof thrown === "object" && "code" in thrown ? { code: thrown.code } : null;
      page2 = {
        resultCount: 0,
        hasNextCursor: false,
        attemptCount: fetchCalls - fetchCallsBeforePage2,
        circuitState: provider.health().state,
        results: [],
        ...(info ? { errorCode: info.code } : {}),
      };
    }
  }

  const safeResult = {
    providerId: "google_places",
    outcome: "success",
    requestedFieldSet: baseRequest.fieldSet,
    requestedMaxResults: baseRequest.maxResults,
    page1,
    ...(page2 ? { page2 } : {}),
  };

  // --- Redaction assertion before ANY stdout ---
  const serialized = JSON.stringify(safeResult);
  const hit = firstForbidden(serialized);
  if (hit) {
    err(`Redaction failure: the result matched a forbidden pattern (${hit}). Nothing was printed.`);
    return { exitCode: 5, reason: "redaction-failure", fetchCalls, safeResult: null };
  }

  out(JSON.stringify(safeResult, null, 2));
  return { exitCode: 0, reason: "search-completed", fetchCalls, safeResult };
}

// --- CLI entry: the ONLY place execution happens. Importing this module
//     as a library runs nothing. ---
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runGooglePlacesLiveDataValidation({
    argv: process.argv.slice(2),
    env: process.env,
    fetchImpl: globalThis.fetch,
    stdout: (l) => process.stdout.write(`${l}\n`),
    stderr: (l) => process.stderr.write(`${l}\n`),
  })
    .then((r) => process.exit(r.exitCode))
    .catch(() => process.exit(1));
}
