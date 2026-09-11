import "server-only";

/**
 * RADAR INTELLIGENCE — safe, secret-free server-side observability.
 *
 * ONE narrow choke point for every diagnostic log line the intelligence
 * layer emits, so a future failure can be told apart by WHICH internal
 * branch it took — without ever recording WHO asked or WHAT was asked.
 *
 * `logRadarIntelligenceEvent` accepts ONLY the five allowlisted fields
 * below (source / code / failureClass / httpStatus / status) and rebuilds
 * a brand-new object by reading just those keys — it never logs the
 * caller's object itself, so an accidental extra field (a clientId, a
 * userId, a raw error) is silently dropped rather than reaching console
 * output. This is deliberately NOT a general-purpose logger.
 *
 * NEVER logged, by construction: an API key, x-api-key, Authorization, a
 * prompt or system instruction, a raw provider response / HTTP body,
 * prospect/customer data, a clientId, a userId, an email, a UUID, a DB
 * URL, a stack trace, or a raw Error#message. `code` is always one of the
 * fixed IntelligenceErrorCode values (already secret-free — see
 * errors.ts) or one of the internal diagnostic-blind-path codes declared
 * below; `failureClass` is always one of ProviderFailureClass;
 * `httpStatus`, if present at all, is RE-VALIDATED here (400–599, a real
 * integer, never coerced from a string) before it can reach console
 * output — a second, independent gate on top of the one in errors.ts.
 * None of these is ever a free-text string built from user/provider input.
 */
import { validateHttpStatus, type IntelligenceErrorCode, type ProviderFailureClass } from "./errors";

export type RadarIntelligenceLogSource = "advisory_core" | "diagnostic_permission_check" | "server_action_boundary";

/**
 * Internal codes for the diagnostic-BLIND paths — i.e. failures that
 * carry no ProviderFailureClass and would otherwise be indistinguishable
 * from one another in `{ status: "error" }`. Never surfaced to the UI;
 * SYSTEM_ADMIN-only exposure is unchanged (this module only ever writes
 * to the server log, never to a returned result).
 */
export const RADAR_INTELLIGENCE_BLIND_PATH_CODES = [
  "INVALID_CLIENT_ID",
  "DISPLAY_CONTEXT_NOT_FOUND",
  "PRE_GATEWAY_LOADER_FAILURE",
  "REGISTRY_GATEWAY_THROW",
  "SYSTEM_ADMIN_CHECK_FAILED",
  "SERVER_ACTION_UNHANDLED_ERROR",
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
  /** The safe RadarAdvisoryUiResult["status"] the caller is about to
   * return — a fixed enum string, never provider/user text. */
  status?: string;
};

const ALLOWED_LOG_KEYS = ["source", "code", "failureClass", "httpStatus", "status"] as const;

/**
 * The ONLY export that writes anywhere. Re-reads just the allowlisted
 * keys off `event` into a fresh object before logging — nothing else on
 * `event`, however it was constructed by the caller, can reach this line.
 * `httpStatus` gets one extra check: it is dropped, not passed through,
 * unless it independently re-validates as a real 400–599 integer.
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
    safe[key] = value;
  }
  console.warn("[RADAR_INTELLIGENCE]", safe);
}
