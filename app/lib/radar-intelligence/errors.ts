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
 * SAFE PROVIDER-ERROR METADATA (OpenAI diagnostics — RADAR INTELLIGENCE V2).
 *
 * A provider's JSON error envelope (`{ error: { type, code, param,
 * message } }`) is UNTRUSTED input. `message` can echo request content
 * (a prompt fragment, a field value) and must NEVER be captured anywhere
 * in this layer. `type` and `code` are drawn from OpenAI's own small,
 * documented, fixed vocabulary — never free text — so they are validated
 * against a CLOSED SET here: a value that isn't a member is dropped
 * entirely (never passed through, never logged verbatim), exactly like
 * `validateHttpStatus` above rejects anything outside 400–599. `param`
 * has no practical closed set (it names one of many possible request
 * fields), so it is instead validated by SHAPE: a short string built only
 * from characters that can appear in a JSON/request field path
 * (letters, digits, `_`, `.`, `[`, `]`) — never punctuation, whitespace,
 * or the field's own value. A `param` that doesn't match this pattern is
 * dropped, not truncated-and-kept.
 *
 * Expanding either closed set is a deliberate, reviewed code change —
 * never something driven by runtime data — matching the "allowlist, not
 * denylist" convention used throughout this file and observability.ts.
 */
export const KNOWN_OPENAI_ERROR_TYPES = [
  "invalid_request_error",
  "authentication_error",
  "permission_error",
  "not_found_error",
  "rate_limit_error",
  "api_error",
  "overloaded_error",
] as const;

export type OpenAiErrorType = (typeof KNOWN_OPENAI_ERROR_TYPES)[number];

export const KNOWN_OPENAI_ERROR_CODES = [
  "invalid_api_key",
  "insufficient_quota",
  "rate_limit_exceeded",
  "model_not_found",
  "context_length_exceeded",
  "invalid_value",
  "unsupported_parameter",
  "unknown_parameter",
  "invalid_type",
  "missing_required_parameter",
  "string_above_max_length",
  "content_policy_violation",
] as const;

export type OpenAiErrorCode = (typeof KNOWN_OPENAI_ERROR_CODES)[number];

/** Max length for a `param` name — real OpenAI field paths (even nested,
 * e.g. `messages[0].role`) are always well under this. */
const MAX_PROVIDER_ERROR_PARAM_LEN = 64;
/** Field-path shape only: letters, digits, underscore, dot, brackets —
 * never punctuation, whitespace, or arbitrary text. */
const SAFE_PROVIDER_ERROR_PARAM_PATTERN = /^[A-Za-z0-9_.[\]]{1,64}$/;

/** A value from a provider's `error.type` is safe to keep ONLY if it is a
 * string AND a member of the closed set above. Anything else (wrong
 * type, unrecognized string, oversized) -> undefined, never logged. */
export function validateProviderErrorType(value: unknown): OpenAiErrorType | undefined {
  if (typeof value !== "string") return undefined;
  return (KNOWN_OPENAI_ERROR_TYPES as readonly string[]).includes(value) ? (value as OpenAiErrorType) : undefined;
}

/** Same discipline as validateProviderErrorType, for `error.code`. */
export function validateProviderErrorCode(value: unknown): OpenAiErrorCode | undefined {
  if (typeof value !== "string") return undefined;
  return (KNOWN_OPENAI_ERROR_CODES as readonly string[]).includes(value) ? (value as OpenAiErrorCode) : undefined;
}

/** `error.param` has no practical closed set — validated by SHAPE
 * (field-path characters only, length-bounded) instead. Never the raw
 * value if it fails the pattern; never truncated-and-kept. */
export function validateProviderErrorParam(value: unknown): string | undefined {
  if (typeof value !== "string") return undefined;
  if (value.length === 0 || value.length > MAX_PROVIDER_ERROR_PARAM_LEN) return undefined;
  return SAFE_PROVIDER_ERROR_PARAM_PATTERN.test(value) ? value : undefined;
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
  /**
   * OPTIONAL safe provider-error metadata (RADAR INTELLIGENCE V2,
   * OpenAI diagnostics) — present ONLY when a genuine non-2xx provider
   * HTTP response carried a well-formed `{error:{type,code,param}}`
   * envelope AND each value independently passed validateProviderError*
   * below. NEVER the provider's `error.message`, never the raw body,
   * never anything else about the response. Explicit, named, string-only
   * fields — deliberately NOT a generic metadata bag — so a caller can
   * never smuggle an arbitrary provider field through this type.
   */
  providerErrorType?: string;
  providerErrorCode?: string;
  providerErrorParam?: string;
};

export function makeIntelligenceError(
  code: IntelligenceErrorCode,
  providerId: IntelligenceProviderId | null = null,
  failureClass?: ProviderFailureClass,
  httpStatus?: number,
  providerErrorType?: unknown,
  providerErrorCode?: unknown,
  providerErrorParam?: unknown,
): IntelligenceError {
  const error: IntelligenceError = {
    code,
    providerId,
    retryable: RETRYABLE_ERROR_CODES.has(code),
    message: SAFE_ERROR_MESSAGES[code],
  };
  // Attach only when supplied, so the 2-arg / 3-arg / 4-arg call keeps
  // its exact pre-existing shape.
  if (failureClass !== undefined) error.failureClass = failureClass;
  const validatedHttpStatus = validateHttpStatus(httpStatus);
  if (validatedHttpStatus !== undefined) error.httpStatus = validatedHttpStatus;
  // Re-validated here regardless of what the caller already checked —
  // the same "never trust the caller" discipline as httpStatus above.
  const validatedType = validateProviderErrorType(providerErrorType);
  if (validatedType !== undefined) error.providerErrorType = validatedType;
  const validatedCode = validateProviderErrorCode(providerErrorCode);
  if (validatedCode !== undefined) error.providerErrorCode = validatedCode;
  const validatedParam = validateProviderErrorParam(providerErrorParam);
  if (validatedParam !== undefined) error.providerErrorParam = validatedParam;
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
