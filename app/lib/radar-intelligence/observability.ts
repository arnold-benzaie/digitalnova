import "server-only";

/**
 * RADAR INTELLIGENCE — safe, secret-free server-side observability.
 * RADAR INTELLIGENCE V2 — extended with three MULTI-PROVIDER-ROUTING
 * fields (provider / fallbackUsed / attempt), each independently
 * re-validated, one new blind-path code (FALLBACK_SUCCEEDED) for the
 * one success-path event worth a log line, and three SAFE OPENAI
 * PROVIDER-ERROR fields (providerErrorType / providerErrorCode /
 * providerErrorParam), each independently re-validated against the
 * closed sets / shape rules in errors.ts.
 *
 * ONE narrow choke point for every diagnostic log line the intelligence
 * layer emits, so a future failure can be told apart by WHICH internal
 * branch it took — without ever recording WHO asked or WHAT was asked.
 *
 * `logRadarIntelligenceEvent` accepts ONLY the eleven allowlisted fields
 * below (source / code / failureClass / httpStatus / provider /
 * fallbackUsed / attempt / status / providerErrorType / providerErrorCode
 * / providerErrorParam) and rebuilds a brand-new object by reading just
 * those keys — it never logs the caller's object itself, so an
 * accidental extra field (a clientId, a userId, a raw error) is silently
 * dropped rather than reaching console output. This is deliberately NOT
 * a general-purpose logger.
 *
 * NEVER logged, by construction: an API key, x-api-key, Authorization, a
 * prompt or system instruction, a raw provider response / HTTP body, a
 * provider's error.message (which can echo request content), prospect/
 * customer data, a clientId, a userId, an email, a UUID, a DB URL, a
 * stack trace, or a raw Error#message. `code` is always one of the
 * fixed IntelligenceErrorCode values (already secret-free — see
 * errors.ts) or one of the internal diagnostic-blind-path codes declared
 * below; `failureClass` is always one of ProviderFailureClass;
 * `httpStatus`, if present at all, is RE-VALIDATED here (400–599, a real
 * integer, never coerced from a string) before it can reach console
 * output — a second, independent gate on top of the one in errors.ts.
 * `provider` is RE-VALIDATED as a known IntelligenceProviderId (the same
 * closed set the whole layer already uses — "anthropic" / "openai" /
 * "deterministic" / a documented future id — never an arbitrary string).
 * `fallbackUsed` is coerced to a strict boolean. `attempt` is
 * RE-VALIDATED as a small non-negative integer (0, 1, or 2 in practice).
 * `providerErrorType` / `providerErrorCode` are RE-VALIDATED against a
 * small closed set of OpenAI's own documented error vocabulary;
 * `providerErrorParam` is RE-VALIDATED as a short field-path-shaped
 * string (never free text). None of these is ever a free-text string
 * built from user/provider input.
 */
import {
  validateHttpStatus,
  validateProviderErrorType,
  validateProviderErrorCode,
  validateProviderErrorParam,
  type IntelligenceErrorCode,
  type ProviderFailureClass,
} from "./errors";
import { isIntelligenceProviderId } from "./types";

export type RadarIntelligenceLogSource = "advisory_core" | "diagnostic_permission_check" | "server_action_boundary";

/**
 * Internal codes for the diagnostic-BLIND paths — i.e. failures (or, for
 * FALLBACK_SUCCEEDED, the one success-path event worth a log line) that
 * would otherwise be indistinguishable from one another in the plain
 * `{ status: "..." }` UI result. Never surfaced to the UI; SYSTEM_ADMIN-only
 * exposure is unchanged (this module only ever writes to the server log,
 * never to a returned result).
 */
export const RADAR_INTELLIGENCE_BLIND_PATH_CODES = [
  "INVALID_CLIENT_ID",
  "DISPLAY_CONTEXT_NOT_FOUND",
  "PRE_GATEWAY_LOADER_FAILURE",
  "REGISTRY_GATEWAY_THROW",
  "SYSTEM_ADMIN_CHECK_FAILED",
  "SERVER_ACTION_UNHANDLED_ERROR",
  "FALLBACK_SUCCEEDED",
] as const;

export type RadarIntelligenceBlindPathCode = (typeof RADAR_INTELLIGENCE_BLIND_PATH_CODES)[number];

export type RadarIntelligenceLogCode = IntelligenceErrorCode | RadarIntelligenceBlindPathCode;

export type RadarIntelligenceLogEvent = {
  source: RadarIntelligenceLogSource;
  code: RadarIntelligenceLogCode;
  /** Only present for a genuine provider transport/response failure. */
  failureClass?: ProviderFailureClass;
  /** Only present alongside failureClass, for a genuine provider HTTP
   * response — re-validated (400–599) below regardless. */
  httpStatus?: number;
  /** The canonical provider id that actually ran (e.g. "anthropic" /
   * "openai") — re-validated against the closed IntelligenceProviderId
   * set below. Never a raw/arbitrary string. */
  provider?: string;
  /** Whether the FALLBACK provider ended up serving this request. */
  fallbackUsed?: boolean;
  /** How many providers were dispatched to (0, 1, or 2) — routing
   * metadata only, never a retry count. */
  attempt?: number;
  /** The safe RadarAdvisoryUiResult["status"] the caller is about to
   * return — a fixed enum string, never provider/user text. */
  status?: string;
  /**
   * RADAR INTELLIGENCE V2 — safe OpenAI provider-error metadata. Present
   * only for a genuine non-2xx OpenAI HTTP response, and only when
   * errors.ts's independent validators accepted the value (closed-set
   * for type/code, safe field-path shape for param). NEVER the
   * provider's error.message, never anything else about the response —
   * see errors.ts's IntelligenceError docstring.
   */
  providerErrorType?: string;
  providerErrorCode?: string;
  providerErrorParam?: string;
};

const ALLOWED_LOG_KEYS = [
  "source",
  "code",
  "failureClass",
  "httpStatus",
  "provider",
  "fallbackUsed",
  "attempt",
  "status",
  "providerErrorType",
  "providerErrorCode",
  "providerErrorParam",
] as const;

/**
 * The ONLY export that writes anywhere. Re-reads just the allowlisted
 * keys off `event` into a fresh object before logging — nothing else on
 * `event`, however it was constructed by the caller, can reach this line.
 * `httpStatus`, `provider`, `attempt`, and the three `providerError*`
 * fields each get one extra check: they are dropped, not passed
 * through, unless they independently re-validate.
 */
export function logRadarIntelligenceEvent(event: RadarIntelligenceLogEvent): void {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_LOG_KEYS) {
    const value = event[key];
    if (value === undefined) continue;
    if (key === "httpStatus") {
      const validated = validateHttpStatus(value);
      if (validated !== undefined) safe.httpStatus = validated;
      continue;
    }
    if (key === "provider") {
      if (isIntelligenceProviderId(value)) safe.provider = value;
      continue;
    }
    if (key === "fallbackUsed") {
      if (typeof value === "boolean") safe.fallbackUsed = value;
      continue;
    }
    if (key === "attempt") {
      if (typeof value === "number" && Number.isInteger(value) && value >= 0 && value <= 2) safe.attempt = value;
      continue;
    }
    if (key === "providerErrorType") {
      const validated = validateProviderErrorType(value);
      if (validated !== undefined) safe.providerErrorType = validated;
      continue;
    }
    if (key === "providerErrorCode") {
      const validated = validateProviderErrorCode(value);
      if (validated !== undefined) safe.providerErrorCode = validated;
      continue;
    }
    if (key === "providerErrorParam") {
      const validated = validateProviderErrorParam(value);
      if (validated !== undefined) safe.providerErrorParam = validated;
      continue;
    }
    safe[key] = value;
  }
  console.warn("[RADAR_INTELLIGENCE]", safe);
}
