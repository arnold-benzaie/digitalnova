import "server-only";

/**
 * RADAR INTELLIGENCE — safe, secret-free server-side observability.
 *
 * ONE narrow choke point for every diagnostic log line the intelligence
 * layer emits, so a future failure can be told apart by WHICH internal
 * branch it took — without ever recording WHO asked or WHAT was asked.
 *
 * `logRadarIntelligenceEvent` accepts ONLY the four allowlisted fields
 * below (source / code / failureClass / status) and rebuilds a brand-new
 * object by reading just those keys — it never logs the caller's object
 * itself, so an accidental extra field (a clientId, a userId, a raw
 * error) is silently dropped rather than reaching console output. This is
 * deliberately NOT a general-purpose logger.
 *
 * NEVER logged, by construction: an API key, x-api-key, Authorization, a
 * prompt or system instruction, a raw provider response / HTTP body,
 * prospect/customer data, a clientId, a userId, an email, a UUID, a DB
 * URL, a stack trace, or a raw Error#message. `code` is always one of the
 * fixed IntelligenceErrorCode values (already secret-free — see
 * errors.ts) or one of the internal diagnostic-blind-path codes declared
 * below; `failureClass` is always one of ProviderFailureClass. Neither is
 * ever a free-text string built from user/provider input.
 */
import type { IntelligenceErrorCode, ProviderFailureClass } from "./errors";

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
  /** The safe RadarAdvisoryUiResult["status"] the caller is about to
   * return — a fixed enum string, never provider/user text. */
  status?: string;
};

const ALLOWED_LOG_KEYS = ["source", "code", "failureClass", "status"] as const;

/**
 * The ONLY export that writes anywhere. Re-reads just the allowlisted
 * keys off `event` into a fresh object before logging — nothing else on
 * `event`, however it was constructed by the caller, can reach this line.
 */
export function logRadarIntelligenceEvent(event: RadarIntelligenceLogEvent): void {
  const safe: Record<string, unknown> = {};
  for (const key of ALLOWED_LOG_KEYS) {
    const value = event[key];
    if (value !== undefined) safe[key] = value;
  }
  console.warn("[RADAR_INTELLIGENCE]", safe);
}
