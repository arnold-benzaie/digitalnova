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
};

export function makeIntelligenceError(
  code: IntelligenceErrorCode,
  providerId: IntelligenceProviderId | null = null,
): IntelligenceError {
  return {
    code,
    providerId,
    retryable: RETRYABLE_ERROR_CODES.has(code),
    message: SAFE_ERROR_MESSAGES[code],
  };
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

  if (name === "AbortError" || name === "TimeoutError") return makeIntelligenceError("PROVIDER_TIMEOUT", providerId);
  if (status === 429) return makeIntelligenceError("PROVIDER_RATE_LIMITED", providerId);
  if (status === 503 || status === 502 || status === 504) return makeIntelligenceError("PROVIDER_UNAVAILABLE", providerId);
  return makeIntelligenceError("PROVIDER_ERROR", providerId);
}

/** Convenience for the built-in fallback path. */
export function noCapableProviderError(): IntelligenceError {
  return makeIntelligenceError("NO_CAPABLE_PROVIDER", DETERMINISTIC_PROVIDER_ID);
}
