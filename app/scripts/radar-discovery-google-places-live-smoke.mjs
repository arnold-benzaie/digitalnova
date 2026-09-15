/**
 * RADAR DISCOVERY ENGINE — Phase C-1 — guarded one-shot live-smoke for
 * the Google Places provider. Mirrors
 * scripts/radar-intelligence-live-smoke.mjs's exact safety discipline —
 * see that file's own header for the full precedent this one follows.
 *
 * Purpose: a HUMAN, in LOCAL DEVELOPMENT, verifies that the real Google
 * Places connection can reach the provider — exactly ONE search, a small
 * result cap, the smallest field mask ("minimal_discovery"), printing
 * only safe fields.
 *
 * SAFETY (all enforced below, all covered by the offline sibling test):
 *  - refuses unless invoked with --i-understand-this-is-a-live-call (the
 *    SAME flag radar-intelligence-live-smoke.mjs already uses — one
 *    phrase to remember across both live-smoke scripts in this repo)
 *  - refuses unless GOOGLE_PLACES_ENABLED is exactly true/1
 *  - refuses unless GOOGLE_PLACES_API_KEY is present (never printed)
 *  - at most ONE provider request per invocation (MAX_DISCOVERY_RETRY_ATTEMPTS
 *    is still active — a transient failure may still retry ONCE, exactly
 *    like every other real call this codebase makes; there is no
 *    script-level loop beyond that)
 *  - maxResults forced to SMOKE_MAX_RESULTS (1)
 *  - fieldSet forced to "minimal_discovery" — the cheapest tier
 *  - a hardcoded, reviewed, non-sensitive search (a public category +
 *    location, not personal/customer data — there is no equivalent
 *    "synthetic PII" concept for a places search the way the AI smoke
 *    needed a fake prospect)
 *  - prints only an allowlist of safe fields, after a redaction assertion
 *  - NEVER imports lib/radar-discovery/discovery-result-store.ts — this
 *    script cannot write to discovery_results even by accident, since
 *    that module is never in its import graph. Writes NOTHING to any
 *    table, ever.
 *  - never creates/edits any .env file
 *  - importing this module runs NOTHING (only the CLI branch executes)
 *
 * This module transitively imports `server-only` modules; run it with
 * the react-server condition, same as the Anthropic smoke's own runbook.
 * It is NOT wired into npm test / pre-commit / CI / build / cron /
 * Vercel — only its offline sibling test is.
 */
import { pathToFileURL } from "node:url";
import { loadRadarDiscoveryConfig } from "../lib/radar-discovery/config-loader.ts";
import { createConfiguredGooglePlacesProvider } from "../lib/radar-discovery/adapters/configured-google-places.ts";

export const ACK_FLAG = "--i-understand-this-is-a-live-call";
export const SMOKE_MAX_RESULTS = 1;

/** Patterns that must NEVER appear in the printed result. */
export const REDACTION_PATTERNS = [/AIza/i, /api[_-]?key/i, /x-goog-api-key/i, /\bauthorization\b/i, /\bbearer\b/i, /database[_-]?url/i, /session[_-]?token/i, /\bclerk\b/i];

/** Hardcoded, reviewed, non-sensitive search — a public category +
 * location, never personal/customer data, never read from any DB. */
export const SMOKE_SEARCH_REQUEST = Object.freeze({
  category: "restaurants",
  city: "Port Louis",
  country: "Mauritius",
  maxResults: SMOKE_MAX_RESULTS,
  fieldSet: "minimal_discovery",
});

function firstForbidden(text) {
  for (const re of REDACTION_PATTERNS) if (re.test(text)) return re.source;
  return null;
}

/**
 * Testable execution core. Injectable argv/env/fetch/writers so the
 * offline sibling test runs fully without network. Returns
 * { exitCode, reason, fetchCalls, safeResult }. NEVER throws.
 */
export async function runGooglePlacesLiveSmoke({ argv = [], env = {}, fetchImpl, stdout, stderr, request = SMOKE_SEARCH_REQUEST } = {}) {
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

  // --- All guards passed: exactly ONE search, minimal field set, capped results ---
  const forcedRequest = { ...request, maxResults: Math.min(SMOKE_MAX_RESULTS, request.maxResults ?? SMOKE_MAX_RESULTS), fieldSet: "minimal_discovery" };

  let outcome;
  let errorInfo = null;
  try {
    const provider = createConfiguredGooglePlacesProvider({
      loadedConfig: { googlePlaces: cfg },
      ...(countingFetch ? { fetchImpl: countingFetch } : {}),
    });
    if (!provider) {
      err("Refused: provider could not be configured despite guards passing. Zero provider calls were made.");
      return { exitCode: 4, reason: "missing-key", fetchCalls: 0, safeResult: null };
    }
    outcome = await provider.search(forcedRequest);
  } catch (thrown) {
    // A typed DiscoveryError (has .code) is safe to surface by CODE only
    // — never its raw form. Anything else is fully swallowed.
    errorInfo = thrown && typeof thrown === "object" && "code" in thrown ? { code: thrown.code, retryable: thrown.retryable === true } : null;
  }

  const safeResult = {
    provider: "google_places",
    requestedFieldSet: forcedRequest.fieldSet,
    requestedMaxResults: forcedRequest.maxResults,
    resultCount: outcome?.results?.length ?? 0,
    hasNextCursor: Boolean(outcome?.nextCursor),
    // Only non-sensitive, already-safe fields from the FIRST result, if
    // any — never phone/email/website/address (this is a connectivity
    // smoke, not a data dump).
    firstResultName: outcome?.results?.[0]?.name ?? null,
    firstResultSource: outcome?.results?.[0]?.source ?? null,
    ...(errorInfo ? { errorCode: errorInfo.code, errorRetryable: errorInfo.retryable } : {}),
  };

  // --- Redaction assertion before ANY stdout ---
  const serialized = JSON.stringify(safeResult);
  const hit = firstForbidden(serialized);
  if (hit) {
    err(`Redaction failure: the result matched a forbidden pattern (${hit}). Nothing was printed.`);
    return { exitCode: 5, reason: "redaction-failure", fetchCalls, safeResult: null };
  }

  out(JSON.stringify(safeResult, null, 2));
  return {
    exitCode: errorInfo ? 1 : 0,
    reason: errorInfo ? "provider-failure" : "search-completed",
    fetchCalls,
    safeResult,
  };
}

// --- CLI entry: the ONLY place execution happens. Importing this module
//     as a library runs nothing. ---
const invokedPath = process.argv[1] ? pathToFileURL(process.argv[1]).href : "";
if (import.meta.url === invokedPath) {
  runGooglePlacesLiveSmoke({
    argv: process.argv.slice(2),
    env: process.env,
    fetchImpl: globalThis.fetch,
    stdout: (l) => process.stdout.write(`${l}\n`),
    stderr: (l) => process.stderr.write(`${l}\n`),
  })
    .then((r) => process.exit(r.exitCode))
    .catch(() => process.exit(1));
}
