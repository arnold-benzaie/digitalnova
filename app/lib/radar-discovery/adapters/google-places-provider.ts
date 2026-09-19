import "server-only";

/**
 * RADAR DISCOVERY ENGINE — Phase C-1 — the REAL DiscoveryProvider for
 * Google Places. Wires together, in this exact order per call:
 *
 *   1. circuit breaker check (free, in-memory — lib/radar-intelligence/
 *      circuit-breaker.ts, REUSED AS-IS, never reimplemented)
 *   2. rate-limit gate (spends a budget unit — rate-limit-gate.ts, itself
 *      a thin wrapper over lib/api-v1/rate-limit.ts::checkRateLimit(),
 *      REUSED AS-IS)
 *   3. the real HTTP transport (google-places-http-transport.ts)
 *   4. bounded retry (mission section 8: at most
 *      errors.ts::MAX_DISCOVERY_RETRY_ATTEMPTS additional attempts,
 *      ONLY for a retryable DiscoveryError, NEVER for 400/401/403/
 *      INVALID_SEARCH_REQUEST-shaped failures)
 *   5. C-0's own pure functions (google-places.ts) for request building,
 *      response normalization, and error classification — UNCHANGED,
 *      not touched by this file.
 *
 * NEVER writes to discovery_results or crm_clients (mission section 5/17
 * — persistence is a separate, later phase). NEVER decides a result
 * becomes a CRM client.
 *
 * `search()` REJECTS (never resolves with a placeholder outcome) when it
 * cannot produce a result — the rejection reason is always a typed
 * DiscoveryError (errors.ts), never a raw Error/SDK exception. This is
 * the same "MUST reject, not resolve, on failure" contract
 * provider.ts's own DiscoveryProvider docstring already specifies.
 *
 * "limited" (mission section 10/11 — how the limited state is
 * represented): NOT tracked by health()/circuit state — a rate-limit
 * denial is a per-call outcome (the thrown QUOTA_EXCEEDED DiscoveryError),
 * not a change to this provider's ongoing connection state. Circuit
 * state (connected/degraded/unavailable) tracks GOOGLE's OWN reliability
 * only (network/5xx failures) — a rate-limit denial never feeds into it,
 * since it says nothing about whether Google itself is reachable.
 */
import { canAttempt, beginProbe, recordFailure, recordSuccess, initCircuit, DEFAULT_CIRCUIT_CONFIG, type CircuitBreakerConfig, type CircuitBreakerSnapshot } from "@/lib/radar-intelligence/circuit-breaker";
import { MAX_DISCOVERY_RETRY_ATTEMPTS, makeDiscoveryError, toDiscoveryError, type DiscoveryError } from "../errors";
import { logDiscoveryProviderEvent } from "../observability";
// MISSION C-2D-0-FIX — TYPE-ONLY import. rate-limit-gate.ts transitively
// imports @/lib/api-v1/rate-limit -> @/db, which throws at MODULE LOAD
// TIME (not call time) when DATABASE_URL is unset — a plain `import { x }`
// here would evaluate that whole chain the instant ANYTHING imports this
// file, even a caller that always supplies its own `checkRateLimit`
// override and never needs the DB-backed default. `import type` is erased
// entirely at compile time (zero runtime import), so referencing this
// module for its TYPE ONLY costs nothing. The real function is resolved
// LAZILY inside search() below, via a dynamic import, only on the code
// path that actually needs it (no override was given).
import type { DiscoveryRateLimitDecision } from "../rate-limit-gate";
import type { DiscoveryDetailsOutcome, DiscoveryFieldSet, DiscoveryProviderCapability, DiscoveryProviderStatus, DiscoverySearchOutcome, DiscoverySearchRequest } from "../types";
import type { DiscoveryProvider } from "../provider";
import {
  buildGooglePlacesDetailsRequest,
  buildGooglePlacesSearchRequest,
  classifyGooglePlacesError,
  GOOGLE_PLACES_CAPABILITIES,
  GOOGLE_PLACES_PROVIDER_ID,
  normalizeGooglePlacesDetailsResult,
  normalizeGooglePlacesSearchResponse,
  type GooglePlacesRawError,
  type GooglePlacesRawResult,
  type GooglePlacesSearchResponse,
} from "./google-places";
import type { GooglePlacesTransport } from "./google-places-http-transport";
import type { ProviderBudgetGate } from "../budget/provider-budget-gate";

export type CreateGooglePlacesProviderDeps = {
  transport: GooglePlacesTransport;
  /** Injectable for tests — defaults to the real, DB-backed gate. */
  checkRateLimit?: (providerId: string) => Promise<DiscoveryRateLimitDecision>;
  /** MISSION C-2D-4-E — Enrichment's OWN rate-limit override, completely
   * independent of `checkRateLimit` above (a different scope — see
   * rate-limit-gate.ts's own comment on why Search and Enrichment must
   * never share a budget). Defaults to the real, DB-backed enrichment
   * gate. */
  checkEnrichmentRateLimit?: (providerId: string) => Promise<DiscoveryRateLimitDecision>;
  /** MISSION C-2D-6-B — RADAR DISCOVERY COST & QUOTA GOVERNANCE. OPTIONAL
   * on purpose, and with NO real-default resolution here (unlike the two
   * rate-limit gates above): a budget reservation must be attributed to a
   * real actor for its audit trail, and this factory has no actor
   * identity of its own — only the calling Server Action does. When
   * absent, NO budget gating occurs at all (100% backward compatible with
   * every existing test/live-smoke script that never supplies one) — the
   * real production wiring is the Server Action's own responsibility
   * (lib/actions/radar-discovery-search.ts /
   * lib/actions/radar-discovery-enrich.ts), constructed via
   * budget/provider-budget-gate.ts::createProviderBudgetGate(). Search and
   * Enrichment use their OWN separate gate — never shared — mirroring the
   * two rate-limit deps above exactly. */
  checkSearchBudget?: ProviderBudgetGate;
  checkEnrichmentBudget?: ProviderBudgetGate;
  /** ms epoch — injectable for deterministic circuit-breaker tests. */
  clock?: () => number;
  circuitConfig?: CircuitBreakerConfig;
};

function toRawError(body: unknown, httpStatus: number): GooglePlacesRawError {
  if (body && typeof body === "object" && "error" in (body as Record<string, unknown>)) {
    return { error: (body as { error?: GooglePlacesRawError["error"] }).error, status: httpStatus };
  }
  return { status: httpStatus };
}

type AttemptResult = { ok: true; body: unknown } | { ok: false; error: DiscoveryError };

async function attemptSearchOnce(transport: GooglePlacesTransport, descriptor: ReturnType<typeof buildGooglePlacesSearchRequest>): Promise<AttemptResult> {
  let result;
  try {
    result = await transport.searchText(descriptor);
  } catch (thrown) {
    return { ok: false, error: toDiscoveryError(thrown, GOOGLE_PLACES_PROVIDER_ID) };
  }
  if (result.status < 200 || result.status >= 300) {
    return { ok: false, error: classifyGooglePlacesError(toRawError(result.body, result.status)) };
  }
  return { ok: true, body: result.body };
}

/** MISSION C-2D-4-E — same shape/contract as attemptSearchOnce() above,
 * reusing the exact same error classification (classifyGooglePlacesError()
 * is already generic across both Places endpoints — the gRPC-style error
 * envelope is a Places (New) platform convention, not a Text-Search-only
 * shape). */
async function attemptDetailsOnce(transport: GooglePlacesTransport, descriptor: ReturnType<typeof buildGooglePlacesDetailsRequest>): Promise<AttemptResult> {
  let result;
  try {
    result = await transport.getDetails(descriptor);
  } catch (thrown) {
    return { ok: false, error: toDiscoveryError(thrown, GOOGLE_PLACES_PROVIDER_ID) };
  }
  if (result.status < 200 || result.status >= 300) {
    return { ok: false, error: classifyGooglePlacesError(toRawError(result.body, result.status)) };
  }
  if (typeof result.body !== "object" || result.body === null) {
    // A 2xx with a non-object body is not a shape Google's real API
    // produces for a successful lookup — treated as a generic provider
    // error rather than silently normalized as "confirmed empty for
    // every field" (which would be indistinguishable from a genuine
    // empty-but-valid response).
    return { ok: false, error: toDiscoveryError({}, GOOGLE_PLACES_PROVIDER_ID) };
  }
  return { ok: true, body: result.body };
}

/**
 * MISSION C-2D-6-B — wraps ONE attempt (initial OR retry — this is called
 * from BOTH call sites in `search()`/`getDetails()` below, once per
 * attempt) with its OWN budget reservation, settled/released immediately
 * after that SAME attempt resolves — never one reservation spanning more
 * than one HTTP attempt (mission decision 7). When `budgetGate` is
 * absent, behaves EXACTLY as before this mission (calls `attempt`
 * directly, no reservation of any kind) — 100% backward compatible with
 * every caller that never supplies one.
 *
 * A budget refusal becomes a `{ ok: false, error }` exactly like a real
 * transport failure would — its `DiscoveryErrorCode`
 * (BUDGET_EXHAUSTED/BUDGET_BLOCKED/BUDGET_PRICE_UNKNOWN) is NOT in
 * RETRYABLE_DISCOVERY_ERROR_CODES (errors.ts), so the EXISTING retry
 * decision in search()/getDetails() below (`attempt.error.retryable`)
 * already refuses to retry a budget-denied attempt WITHOUT any change to
 * that logic — mission decision 11 ("si le budget ne permet pas le
 * retry: ne pas effectuer le retry") falls out of the existing
 * retryable-set discipline for free.
 */
/** `transportAttempted: false` marks a BUDGET refusal that never reached
 * the transport at all — the caller (search()/getDetails() below) must
 * NEVER call recordFailure() on the circuit breaker for this case: a
 * self-imposed budget refusal says nothing about Google's own
 * reachability, the exact same reasoning already applied to a rate-limit
 * denial (see this file's own header on why THAT never touches circuit
 * state either). */
type BudgetAwareAttemptResult = AttemptResult & { transportAttempted: boolean };

async function attemptWithBudget<D>(attempt: (descriptor: D) => Promise<AttemptResult>, descriptor: D, budgetGate: ProviderBudgetGate | undefined, attemptNumber: number): Promise<BudgetAwareAttemptResult> {
  if (!budgetGate) {
    const result = await attempt(descriptor);
    return { ...result, transportAttempted: true };
  }

  const reservation = await budgetGate.reserve(attemptNumber);
  if (!reservation.allowed) {
    return { ok: false, error: makeDiscoveryError(reservation.errorCode, GOOGLE_PLACES_PROVIDER_ID), transportAttempted: false };
  }

  const result = await attempt(descriptor);
  await budgetGate.settle(reservation.reservationId, result.ok);
  return { ...result, transportAttempted: true };
}

function circuitToConnectionState(circuit: CircuitBreakerSnapshot): "connected" | "degraded" | "unavailable" {
  if (circuit.state === "CLOSED") return "connected";
  if (circuit.state === "HALF_OPEN") return "degraded";
  return "unavailable";
}

/**
 * Constructs a REAL, network-capable DiscoveryProvider. The caller
 * (configured-google-places.ts) is the ONLY place that decides whether to
 * call this at all (based on effectiveEnabled + a real credential) — this
 * factory itself has no opinion on configuration, only on HOW a search
 * proceeds once genuinely invoked.
 */
export function createGooglePlacesProvider(deps: CreateGooglePlacesProviderDeps): DiscoveryProvider {
  const transport = deps.transport;
  // MISSION C-2D-0-FIX — the injected override, if any, is captured here
  // (synchronously, costs nothing). The DB-backed DEFAULT is resolved
  // LAZILY, inside search() below, via a dynamic import — so a caller
  // that always supplies its own `checkRateLimit` (e.g. the guarded
  // live-smoke script, via configured-google-places.ts) never causes
  // rate-limit-gate.ts (and therefore @/lib/api-v1/rate-limit -> @/db) to
  // be evaluated at all. See this file's own import comment.
  const injectedCheckRateLimit = deps.checkRateLimit;
  // MISSION C-2D-4-E — resolved lazily inside getDetails() below, exactly
  // mirroring injectedCheckRateLimit's own DB-avoidance discipline (this
  // file's own import comment) — a caller that never enriches anything
  // never pays the DATABASE_URL-requiring import cost either.
  const injectedCheckEnrichmentRateLimit = deps.checkEnrichmentRateLimit;
  // MISSION C-2D-6-B — NO lazy dynamic-import default exists for either of
  // these (unlike the two rate-limit deps above) — see this file's own
  // CreateGooglePlacesProviderDeps docstring on why a budget gate always
  // needs an actor identity this factory never has. `undefined` here means
  // "no budget gating for this provider instance" — attemptWithBudget()'s
  // own `if (!budgetGate) return attempt(descriptor)` branch.
  const searchBudgetGate = deps.checkSearchBudget;
  const enrichmentBudgetGate = deps.checkEnrichmentBudget;
  const nowFn = deps.clock ?? (() => Date.now());
  const circuitConfig = deps.circuitConfig ?? DEFAULT_CIRCUIT_CONFIG;

  let circuit: CircuitBreakerSnapshot = initCircuit();

  return {
    id: GOOGLE_PLACES_PROVIDER_ID,

    capabilities(): readonly DiscoveryProviderCapability[] {
      return GOOGLE_PLACES_CAPABILITIES;
    },

    health(): DiscoveryProviderStatus {
      return {
        id: GOOGLE_PLACES_PROVIDER_ID,
        state: circuitToConnectionState(circuit),
        capabilities: GOOGLE_PLACES_CAPABILITIES,
        lastCheckedAt: null,
      };
    },

    async search(request: DiscoverySearchRequest): Promise<DiscoverySearchOutcome> {
      const startedAt = nowFn();

      if (!canAttempt(circuit, startedAt, circuitConfig)) {
        logDiscoveryProviderEvent({
          providerId: GOOGLE_PLACES_PROVIDER_ID,
          outcome: "failure",
          errorCode: "PROVIDER_UNAVAILABLE",
          latencyMs: 0,
          attemptCount: 0,
          circuitState: circuitToConnectionState(circuit),
        });
        throw makeDiscoveryError("PROVIDER_UNAVAILABLE", GOOGLE_PLACES_PROVIDER_ID);
      }
      if (circuit.state !== "CLOSED") {
        circuit = beginProbe(circuit, startedAt, circuitConfig);
      }

      // Resolved on first use, never at module load — see this file's own
      // import comment and the constructor's own comment above.
      const checkRateLimit = injectedCheckRateLimit ?? (await import("../rate-limit-gate")).checkDiscoveryProviderRateLimit;
      const rateLimit = await checkRateLimit(GOOGLE_PLACES_PROVIDER_ID);
      if (!rateLimit.allowed) {
        // Deliberately does NOT touch circuit state — see this file's
        // own header on why a self-imposed rate limit says nothing about
        // Google's own reliability.
        logDiscoveryProviderEvent({
          providerId: GOOGLE_PLACES_PROVIDER_ID,
          outcome: "failure",
          errorCode: "QUOTA_EXCEEDED",
          latencyMs: nowFn() - startedAt,
          attemptCount: 0,
        });
        throw makeDiscoveryError("QUOTA_EXCEEDED", GOOGLE_PLACES_PROVIDER_ID);
      }

      const descriptor = buildGooglePlacesSearchRequest(request);

      let attempt = await attemptWithBudget(attemptSearchOnce.bind(null, transport), descriptor, searchBudgetGate, 1);
      let attemptsMade = 1;

      while (!attempt.ok) {
        // MISSION C-2D-6-B — a budget refusal never reached the
        // transport, so it must never count against Google's own
        // reachability (same reasoning as the rate-limit gate above).
        if (attempt.transportAttempted) {
          circuit = recordFailure(circuit, nowFn(), circuitConfig);
        }
        const canRetry = attempt.error.retryable && attemptsMade <= MAX_DISCOVERY_RETRY_ATTEMPTS && canAttempt(circuit, nowFn(), circuitConfig);
        if (!canRetry) {
          logDiscoveryProviderEvent({
            providerId: GOOGLE_PLACES_PROVIDER_ID,
            outcome: "failure",
            errorCode: attempt.error.code,
            latencyMs: nowFn() - startedAt,
            attemptCount: attemptsMade,
            circuitState: circuitToConnectionState(circuit),
          });
          throw attempt.error;
        }
        // MISSION C-2D-6-B — the retry is its OWN, separately-reserved
        // attempt (mission decision 7): attemptNumber increments, never
        // reusing attempt 1's reservation.
        attempt = await attemptWithBudget(attemptSearchOnce.bind(null, transport), descriptor, searchBudgetGate, attemptsMade + 1);
        attemptsMade += 1;
      }

      circuit = recordSuccess();
      const { results, nextCursor } = normalizeGooglePlacesSearchResponse(attempt.body as GooglePlacesSearchResponse);
      logDiscoveryProviderEvent({
        providerId: GOOGLE_PLACES_PROVIDER_ID,
        outcome: "success",
        latencyMs: nowFn() - startedAt,
        resultCount: results.length,
        attemptCount: attemptsMade,
        circuitState: circuitToConnectionState(circuit),
      });
      return { results, nextCursor };
    },

    // MISSION C-2D-4-E — Enrichment Engine. Deliberately mirrors search()'s
    // exact structure (circuit breaker -> rate-limit gate -> transport ->
    // bounded retry -> normalize -> observability) so the two code paths
    // stay reviewably symmetric — but shares ONLY the circuit breaker
    // (both hit the same underlying Google reachability), never the
    // rate-limit gate (a separate scope — see rate-limit-gate.ts's own
    // comment) and never the field-mask mechanism (buildGooglePlacesDetailsFieldMask()
    // takes no arguments at all — `fieldSet` below is accepted for
    // interface symmetry/observability only, never consulted to build the
    // request).
    async getDetails(sourceId: string, fieldSet: DiscoveryFieldSet): Promise<DiscoveryDetailsOutcome> {
      const startedAt = nowFn();

      if (!canAttempt(circuit, startedAt, circuitConfig)) {
        logDiscoveryProviderEvent({
          providerId: GOOGLE_PLACES_PROVIDER_ID,
          outcome: "failure",
          errorCode: "PROVIDER_UNAVAILABLE",
          latencyMs: 0,
          attemptCount: 0,
          circuitState: circuitToConnectionState(circuit),
        });
        throw makeDiscoveryError("PROVIDER_UNAVAILABLE", GOOGLE_PLACES_PROVIDER_ID);
      }
      if (circuit.state !== "CLOSED") {
        circuit = beginProbe(circuit, startedAt, circuitConfig);
      }

      const checkEnrichmentRateLimit = injectedCheckEnrichmentRateLimit ?? (await import("../rate-limit-gate")).checkDiscoveryEnrichmentProviderRateLimit;
      const rateLimit = await checkEnrichmentRateLimit(GOOGLE_PLACES_PROVIDER_ID);
      if (!rateLimit.allowed) {
        logDiscoveryProviderEvent({
          providerId: GOOGLE_PLACES_PROVIDER_ID,
          outcome: "failure",
          errorCode: "QUOTA_EXCEEDED",
          latencyMs: nowFn() - startedAt,
          attemptCount: 0,
        });
        throw makeDiscoveryError("QUOTA_EXCEEDED", GOOGLE_PLACES_PROVIDER_ID);
      }

      const descriptor = buildGooglePlacesDetailsRequest(sourceId);
      void fieldSet; // accepted for interface symmetry only — see this method's own header.

      let attempt = await attemptWithBudget(attemptDetailsOnce.bind(null, transport), descriptor, enrichmentBudgetGate, 1);
      let attemptsMade = 1;

      while (!attempt.ok) {
        // MISSION C-2D-6-B — see search()'s own identical comment above.
        if (attempt.transportAttempted) {
          circuit = recordFailure(circuit, nowFn(), circuitConfig);
        }
        const canRetry = attempt.error.retryable && attemptsMade <= MAX_DISCOVERY_RETRY_ATTEMPTS && canAttempt(circuit, nowFn(), circuitConfig);
        if (!canRetry) {
          logDiscoveryProviderEvent({
            providerId: GOOGLE_PLACES_PROVIDER_ID,
            outcome: "failure",
            errorCode: attempt.error.code,
            latencyMs: nowFn() - startedAt,
            attemptCount: attemptsMade,
            circuitState: circuitToConnectionState(circuit),
          });
          throw attempt.error;
        }
        attempt = await attemptWithBudget(attemptDetailsOnce.bind(null, transport), descriptor, enrichmentBudgetGate, attemptsMade + 1);
        attemptsMade += 1;
      }

      circuit = recordSuccess();
      const result = normalizeGooglePlacesDetailsResult(attempt.body as GooglePlacesRawResult);
      logDiscoveryProviderEvent({
        providerId: GOOGLE_PLACES_PROVIDER_ID,
        outcome: "success",
        latencyMs: nowFn() - startedAt,
        resultCount: 1,
        attemptCount: attemptsMade,
        circuitState: circuitToConnectionState(circuit),
      });
      return { result };
    },
  };
}
