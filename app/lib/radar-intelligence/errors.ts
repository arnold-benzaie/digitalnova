/**
 * RADAR INTELLIGENCE V1 — Slice 1 — normalized failure model.
 *
 * The intelligence layer NEVER lets a raw provider/SDK error reach a
 * caller or the UI: no HTTP body, no SDK exception text, no API key, no
 * token, no stack trace. Every failure collapses to one stable code from
 * INTELLIGENCE_ERROR_CODES plus a fixed, generic, non-sensitive message.
 */
import { DETERMINISTIC_PROVIDER_ID, type IntelligenceProviderId } from "./types";

export const INTELLIGENCE_ERROR_CODES = [
  "PROVIDER_DISCONNECTED",
  "PROVIDER_DISABLED",
  "PROVIDER_UNAVAILABLE",
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_ERROR",
  "NO_CAPABLE_PROVIDER",
  "INVALID_INTELLIGENCE_REQUEST",
] as const;

export type IntelligenceErrorCode = (typeof INTELLIGENCE_ERROR_CODES)[number];

export function isIntelligenceErrorCode(value: unknown): value is IntelligenceErrorCode {
  return typeof value === "string" && (INTELLIGENCE_ERROR_CODES as readonly string[]).includes(value);
}

/**
 * A COARSE, non-sensitive failure bucket, kept ALONGSIDE the stable
 * `code` (never replacing it). It exists only so an operator with the
 * SYSTEM_ADMIN permission can tell "the provider rejected us" (4xx) from
 * "the provider is broken" (5xx) from a timeout / network / parse fault,
 * without any raw status number, body, header, or exception text ever
 * leaving this module. Never shown to a non-SYSTEM_ADMIN caller.
 */
export const PROVIDER_FAILURE_CLASSES = [
  "PROVIDER_4XX",
  "PROVIDER_5XX",
  "PROVIDER_TIMEOUT",
  "PROVIDER_NETWORK",
  "PROVIDER_PARSE",
  "PROVIDER_UNKNOWN",
] as const;

export type ProviderFailureClass = (typeof PROVIDER_FAILURE_CLASSES)[number];

export function isProviderFailureClass(value: unknown): value is ProviderFailureClass {
  return typeof value === "string" && (PROVIDER_FAILURE_CLASSES as readonly string[]).includes(value);
}

/**
 * Bucket an HTTP status into the coarse class. 400–499 -> PROVIDER_4XX,
 * 500–599 -> PROVIDER_5XX, anything else (incl. non-finite) -> undefined.
 * The raw number is consumed here and never propagated.
 */
export function classifyHttpStatus(status: number): "PROVIDER_4XX" | "PROVIDER_5XX" | undefined {
  if (!Number.isFinite(status)) return undefined;
  if (status >= 400 && status <= 499) return "PROVIDER_4XX";
  if (status >= 500 && status <= 599) return "PROVIDER_5XX";
  return undefined;
}

/**
 * Validates a candidate HTTP status for safe exposure alongside
 * `failureClass`: it must be a plain JS `number` (never coerced from a
 * string — "401" is rejected, not parsed), an integer, and inside the
 * real HTTP error range 400–599. NaN, Infinity, floats, 2xx/3xx, and
 * out-of-range values all -> undefined. This is the ONLY gate through
 * which a raw provider status number may reach an IntelligenceError,
 * a UI result, or a log line — never any other field of the response.
 */
export function validateHttpStatus(value: unknown): number | undefined {
  if (typeof value !== "number") return undefined;
  if (!Number.isInteger(value)) return undefined;
  if (value < 400 || value > 599) return undefined;
  return value;
}

/**
 * Fixed, generic copy per code. Deliberately provider-neutral and free of
 * any interpolation — a UI would localize by CODE, not by rendering these.
 * They must never contain an id, a raw exception, or a secret.
 */
export const SAFE_ERROR_MESSAGES: Record<IntelligenceErrorCode, string> = {
  PROVIDER_DISCONNECTED: "No intelligence provider is connected.",
  PROVIDER_DISABLED: "The intelligence provider is disabled.",
  PROVIDER_UNAVAILABLE: "The intelligence provider is temporarily unavailable.",
  PROVIDER_TIMEOUT: "The intelligence provider did not respond in time.",
  PROVIDER_RATE_LIMITED: "The intelligence provider is rate limited.",
  PROVIDER_ERROR: "The intelligence provider returned an error.",
  NO_CAPABLE_PROVIDER: "No connected provider can serve this request.",
  INVALID_INTELLIGENCE_REQUEST: "The intelligence request is invalid.",
};

/** Codes for which a bounded retry may help. Never includes deterministic
 * failures of intent (INVALID_INTELLIGENCE_REQUEST / NO_CAPABLE_PROVIDER /
 * PROVIDER_DISABLED / PROVIDER_DISCONNECTED). */
export const RETRYABLE_ERROR_CODES: ReadonlySet<IntelligenceErrorCode> = new Set<IntelligenceErrorCode>([
  "PROVIDER_TIMEOUT",
  "PROVIDER_RATE_LIMITED",
  "PROVIDER_UNAVAILABLE",
]);

export type IntelligenceError = {
  code: IntelligenceErrorCode;
  providerId: IntelligenceProviderId | null;
  retryable: boolean;
  /** Always one of SAFE_ERROR_MESSAGES — never a raw provider string. */
  message: string;
  /**
   * OPTIONAL coarse bucket for operator diagnostics only. Present only
   * for a genuine provider transport/response failure; absent for the
   * designed no-provider states. Only ever one of PROVIDER_FAILURE_CLASSES.
   */
  failureClass?: ProviderFailureClass;
  /**
   * OPTIONAL exact HTTP status, present ONLY when a real provider HTTP
   * response carried one (never for a timeout / network / parse / local
   * / pre-gateway failure, and never fabricated). Always validated
   * 400–599 by validateHttpStatus before it ever reaches this field —
   * see makeIntelligenceError below, the sole place that sets it.
   */
  httpStatus?: number;
};

export function makeIntelligenceError(
  code: IntelligenceErrorCode,
  providerId: IntelligenceProviderId | null = null,
  failureClass?: ProviderFailureClass,
  httpStatus?: number,
): IntelligenceError {
  const error: IntelligenceError = {
    code,
    providerId,
    retryable: RETRYABLE_ERROR_CODES.has(code),
    message: SAFE_ERROR_MESSAGES[code],
  };
  // Attach only when supplied, so the 2-arg / 3-arg call keeps its exact
  // pre-existing shape.
  if (failureClass !== undefined) error.failureClass = failureClass;
  const validatedHttpStatus = validateHttpStatus(httpStatus);
  if (validatedHttpStatus !== undefined) error.httpStatus = validatedHttpStatus;
  return error;
}

/**
 * The sanitization boundary for provider failures: turn ANYTHING thrown by
 * a future adapter (an Error, a string, an SDK object with response bodies,
 * a rejected fetch) into a safe IntelligenceError. The raw value is read
 * ONLY to classify a couple of well-known shapes (an AbortError -> TIMEOUT,
 * a `status === 429` -> RATE_LIMITED); its text is never copied out.
 */
export function toIntelligenceError(
  thrown: unknown,
  providerId: IntelligenceProviderId | null = null,
): IntelligenceError {
  const name = typeof thrown === "object" && thrown !== null && "name" in thrown ? String((thrown as { name?: unknown }).name) : "";
  const status =
    typeof thrown === "object" && thrown !== null && "status" in thrown && typeof (thrown as { status?: unknown }).status === "number"
      ? (thrown as { status: number }).status
      : undefined;
  // Only ever a candidate for a GENUINE provider HTTP response — never
  // attached to the timeout / network / parse / unknown branches below,
  // even when `status` happens to be set on the thrown object, and
  // always re-validated (400–599) by makeIntelligenceError itself.
  const httpStatus = validateHttpStatus(status);

  if (name === "AbortError" || name === "TimeoutError") return makeIntelligenceError("PROVIDER_TIMEOUT", providerId, "PROVIDER_TIMEOUT");
  if (status === 429) return makeIntelligenceError("PROVIDER_RATE_LIMITED", providerId, "PROVIDER_4XX", httpStatus);
  if (status === 503 || status === 502 || status === 504) {
    return makeIntelligenceError("PROVIDER_UNAVAILABLE", providerId, "PROVIDER_5XX", httpStatus);
  }
  // Fixed transport error NAMES from anthropic-http-transport.ts. The
  // name is a constant we set ourselves — never attacker/provider text.
  // Neither carries a real HTTP status (a network fault never reached a
  // response; an invalid-JSON fault followed a 2xx, outside 400–599).
  if (name === "TransportNetworkError") return makeIntelligenceError("PROVIDER_ERROR", providerId, "PROVIDER_NETWORK");
  if (name === "InvalidJsonError") return makeIntelligenceError("PROVIDER_ERROR", providerId, "PROVIDER_PARSE");
  const httpClass = typeof status === "number" ? classifyHttpStatus(status) : undefined;
  if (httpClass) return makeIntelligenceError("PROVIDER_ERROR", providerId, httpClass, httpStatus);
  return makeIntelligenceError("PROVIDER_ERROR", providerId, "PROVIDER_UNKNOWN");
}

/** Convenience for the built-in fallback path. */
export function noCapableProviderError(): IntelligenceError {
  return makeIntelligenceError("NO_CAPABLE_PROVIDER", DETERMINISTIC_PROVIDER_ID);
}
