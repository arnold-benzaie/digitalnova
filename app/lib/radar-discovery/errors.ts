/**
 * RADAR DISCOVERY ENGINE — Phase C-0 — normalized failure model.
 *
 * Mirrors lib/radar-intelligence/errors.ts's exact discipline: a future
 * adapter's raw provider/SDK error NEVER reaches a caller — no HTTP body,
 * no SDK exception text, no API key, no stack trace. Every failure
 * collapses to one stable code from DISCOVERY_ERROR_CODES plus a fixed,
 * generic, non-sensitive message.
 *
 * REUSE, NOT DUPLICATION: `ProviderFailureClass` / `classifyHttpStatus` /
 * `validateHttpStatus` are imported directly from radar-intelligence's own
 * errors.ts — those three are genuinely provider-agnostic (a coarse
 * 4xx/5xx/timeout/network/parse/unknown transport bucket has nothing to
 * do with AI specifically) and re-implementing them here would be exactly
 * the "second parallel mechanism" this phase was told not to build.
 * DISCOVERY_ERROR_CODES itself is NOT reused — it is a different, smaller
 * closed set anchored to this domain's own designed states (no
 * `INVALID_INTELLIGENCE_REQUEST`/`PROVIDER_DISABLED` here; those are
 * AI-governance-specific), so it is a genuinely new type, not a copy.
 */
import { classifyHttpStatus, validateHttpStatus, type ProviderFailureClass } from "@/lib/radar-intelligence/errors";
import type { DiscoveryProviderId } from "./types";

export { classifyHttpStatus, validateHttpStatus };
export type { ProviderFailureClass };

export const DISCOVERY_ERROR_CODES = [
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_ERROR",
  "NO_CAPABLE_PROVIDER",
  "INVALID_SEARCH_REQUEST",
  // PHASE C-1 — deliberately distinct from PROVIDER_RATE_LIMITED: that
  // code means the PROVIDER itself rejected us (a genuine Google 429);
  // this one means OUR OWN internal guard-rail (rate-limit-gate.ts)
  // refused the call BEFORE it ever reached Google — the two facts must
  // stay distinguishable (same reasoning already applied to G4B-2's
  // AI_QUOTA_* codes vs. a provider's own rate limit).
  "QUOTA_EXCEEDED",
] as const;

export type DiscoveryErrorCode = (typeof DISCOVERY_ERROR_CODES)[number];

export function isDiscoveryErrorCode(value: unknown): value is DiscoveryErrorCode {
  return typeof value === "string" && (DISCOVERY_ERROR_CODES as readonly string[]).includes(value);
}

/** Fixed, generic copy per code — never interpolated, never a raw
 * provider string. */
export const SAFE_DISCOVERY_ERROR_MESSAGES: Record<DiscoveryErrorCode, string> = {
  PROVIDER_UNAVAILABLE: "The discovery provider is temporarily unavailable.",
  PROVIDER_TIMEOUT: "The discovery provider did not respond in time.",
  PROVIDER_RATE_LIMITED: "The discovery provider is rate limited.",
  PROVIDER_ERROR: "The discovery provider returned an error.",
  NO_CAPABLE_PROVIDER: "No connected provider can serve this request.",
  INVALID_SEARCH_REQUEST: "The search request is invalid.",
  QUOTA_EXCEEDED: "The discovery request budget has been reached for this window.",
};

/**
 * Codes for which a BOUNDED retry may help (mission section 10: "pas de
 * retry infini, pas de retry automatique d'une erreur manifestement non
 * retryable"). NEVER includes a deterministic failure of intent
 * (INVALID_SEARCH_REQUEST / NO_CAPABLE_PROVIDER) — retrying those can
 * never succeed and would only waste a request-quota unit.
 */
export const RETRYABLE_DISCOVERY_ERROR_CODES: ReadonlySet<DiscoveryErrorCode> = new Set<DiscoveryErrorCode>(["PROVIDER_TIMEOUT", "PROVIDER_RATE_LIMITED", "PROVIDER_UNAVAILABLE"]);

export function isRetryableDiscoveryErrorCode(code: DiscoveryErrorCode): boolean {
  return RETRYABLE_DISCOVERY_ERROR_CODES.has(code);
}

/** Hard ceiling mirroring radar-intelligence's MAX_PROVIDER_ATTEMPTS-style
 * bound — a future gateway may retry a retryable failure AT MOST this
 * many additional times (never unbounded). */
export const MAX_DISCOVERY_RETRY_ATTEMPTS = 1;

export type DiscoveryError = {
  code: DiscoveryErrorCode;
  providerId: DiscoveryProviderId | null;
  retryable: boolean;
  /** Always one of SAFE_DISCOVERY_ERROR_MESSAGES — never a raw provider string. */
  message: string;
  failureClass?: ProviderFailureClass;
  httpStatus?: number;
};

export function makeDiscoveryError(code: DiscoveryErrorCode, providerId: DiscoveryProviderId | null = null, failureClass?: ProviderFailureClass, httpStatus?: number): DiscoveryError {
  const error: DiscoveryError = {
    code,
    providerId,
    retryable: isRetryableDiscoveryErrorCode(code),
    message: SAFE_DISCOVERY_ERROR_MESSAGES[code],
  };
  if (failureClass !== undefined) error.failureClass = failureClass;
  const validated = validateHttpStatus(httpStatus);
  if (validated !== undefined) error.httpStatus = validated;
  return error;
}

/**
 * The sanitization boundary for ANY future adapter failure: turns
 * anything thrown (an Error, a string, an SDK object, a rejected fetch)
 * into a safe DiscoveryError. The raw value is read ONLY to classify a
 * couple of well-known shapes; its text is never copied out. Mirrors
 * toIntelligenceError()'s exact classification order.
 */
export function toDiscoveryError(thrown: unknown, providerId: DiscoveryProviderId | null = null): DiscoveryError {
  const name = typeof thrown === "object" && thrown !== null && "name" in thrown ? String((thrown as { name?: unknown }).name) : "";
  const status =
    typeof thrown === "object" && thrown !== null && "status" in thrown && typeof (thrown as { status?: unknown }).status === "number" ? (thrown as { status: number }).status : undefined;
  const httpStatus = validateHttpStatus(status);

  if (name === "AbortError" || name === "TimeoutError") return makeDiscoveryError("PROVIDER_TIMEOUT", providerId, "PROVIDER_TIMEOUT");
  if (status === 429) return makeDiscoveryError("PROVIDER_RATE_LIMITED", providerId, "PROVIDER_4XX", httpStatus);
  if (status === 503 || status === 502 || status === 504) return makeDiscoveryError("PROVIDER_UNAVAILABLE", providerId, "PROVIDER_5XX", httpStatus);
  const httpClass = typeof status === "number" ? classifyHttpStatus(status) : undefined;
  if (httpClass) return makeDiscoveryError("PROVIDER_ERROR", providerId, httpClass, httpStatus);
  return makeDiscoveryError("PROVIDER_ERROR", providerId, "PROVIDER_UNKNOWN");
}

export function noCapableProviderError(): DiscoveryError {
  return makeDiscoveryError("NO_CAPABLE_PROVIDER", null);
}
