/**
 * RADAR DISCOVERY ENGINE — Phase C-1 — safe, secret-free server-side
 * observability. Mirrors lib/radar-intelligence/observability.ts's own
 * discipline (allowlist-only field reconstruction — the caller's raw
 * object is never logged directly), scoped down to what mission section
 * 19 explicitly allows: provider name, outcome, error class, latency,
 * result count, retry count, circuit state. NEVER an API key, an
 * Authorization/X-Goog-Api-Key header value, a raw request/response
 * body, or personal data.
 */
import { DISCOVERY_ERROR_CODES, type DiscoveryErrorCode } from "./errors";
import { DISCOVERY_PROVIDER_CONNECTION_STATES, type DiscoveryProviderConnectionState } from "./types";

export type DiscoveryProviderLogOutcome = "success" | "failure";

export type DiscoveryProviderLogEvent = {
  providerId: string;
  outcome: DiscoveryProviderLogOutcome;
  /** Only present on outcome "failure". Re-validated against the closed
   * set below regardless of what the caller passes. */
  errorCode?: DiscoveryErrorCode;
  latencyMs: number;
  /** Only present on outcome "success". */
  resultCount?: number;
  /** Total attempts made for this call, including the initial one (1 or
   * 1 + MAX_DISCOVERY_RETRY_ATTEMPTS). */
  attemptCount: number;
  circuitState?: DiscoveryProviderConnectionState;
};

const ALLOWED_LOG_KEYS = ["providerId", "outcome", "errorCode", "latencyMs", "resultCount", "attemptCount", "circuitState"] as const;

function safeProviderId(value: string): string | undefined {
  // Free text by design (mission C-0: no closed provider-id set) — only
  // guarded against pathological/oversized values, never against a
  // specific vocabulary.
  return typeof value === "string" && value.length > 0 && value.length <= 64 ? value : undefined;
}

function safeNonNegativeInt(value: number | undefined): number | undefined {
  return typeof value === "number" && Number.isInteger(value) && value >= 0 ? value : undefined;
}

/**
 * The ONLY export that writes anywhere. Re-reads just the allowlisted
 * keys off `event`, re-validating each against its own closed set/shape,
 * before ever reaching console output.
 */
export function logDiscoveryProviderEvent(event: DiscoveryProviderLogEvent): void {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_LOG_KEYS) {
    const value = event[key];
    if (value === undefined) continue;
    if (key === "providerId") {
      const validated = safeProviderId(value as string);
      if (validated !== undefined) safe.providerId = validated;
      continue;
    }
    if (key === "outcome") {
      if (value === "success" || value === "failure") safe.outcome = value;
      continue;
    }
    if (key === "errorCode") {
      if ((DISCOVERY_ERROR_CODES as readonly string[]).includes(value as string)) safe.errorCode = value;
      continue;
    }
    if (key === "circuitState") {
      if ((DISCOVERY_PROVIDER_CONNECTION_STATES as readonly string[]).includes(value as string)) safe.circuitState = value;
      continue;
    }
    if (key === "latencyMs" || key === "resultCount" || key === "attemptCount") {
      const validated = safeNonNegativeInt(value as number);
      if (validated !== undefined) safe[key] = validated;
      continue;
    }
  }
  console.warn("[RADAR_DISCOVERY]", safe);
}
