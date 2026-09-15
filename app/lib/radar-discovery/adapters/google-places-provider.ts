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
import { checkDiscoveryProviderRateLimit, type DiscoveryRateLimitDecision } from "../rate-limit-gate";
import type { DiscoveryProviderCapability, DiscoveryProviderStatus, DiscoverySearchOutcome, DiscoverySearchRequest } from "../types";
import type { DiscoveryProvider } from "../provider";
import {
  buildGooglePlacesSearchRequest,
  classifyGooglePlacesError,
  GOOGLE_PLACES_CAPABILITIES,
  GOOGLE_PLACES_PROVIDER_ID,
  normalizeGooglePlacesSearchResponse,
  type GooglePlacesRawError,
  type GooglePlacesSearchResponse,
} from "./google-places";
import type { GooglePlacesTransport } from "./google-places-http-transport";

export type CreateGooglePlacesProviderDeps = {
  transport: GooglePlacesTransport;
  /** Injectable for tests — defaults to the real, DB-backed gate. */
  checkRateLimit?: (providerId: string) => Promise<DiscoveryRateLimitDecision>;
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
  const checkRateLimit = deps.checkRateLimit ?? checkDiscoveryProviderRateLimit;
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

      let attempt = await attemptSearchOnce(transport, descriptor);
      let attemptsMade = 1;

      while (!attempt.ok) {
        circuit = recordFailure(circuit, nowFn(), circuitConfig);
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
        attempt = await attemptSearchOnce(transport, descriptor);
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
  };
}
