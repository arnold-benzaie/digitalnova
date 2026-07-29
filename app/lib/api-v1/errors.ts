/**
 * Shared error vocabulary for every /api/v1 route — not just auth
 * (lib/api-v1/auth.ts's ApiAuthError extends this), also request
 * validation (bad pagination params) and resource lookups (not found /
 * belongs to another organization, deliberately using the SAME code+
 * message for both — see lib/api-v1/audits.ts). One place maps every
 * code to its HTTP status, so a route can never accidentally pair a code
 * with the wrong status.
 */
export type ApiErrorCode =
  | "MISSING_API_KEY"
  | "MALFORMED_API_KEY"
  | "INVALID_API_KEY"
  | "API_KEY_REVOKED"
  | "API_KEY_EXPIRED"
  | "INTEGRATION_INACTIVE"
  | "INTEGRATION_EXPIRED"
  | "FORBIDDEN_SCOPE"
  | "SERVICE_NOT_CONFIGURED"
  | "VALIDATION_ERROR"
  | "NOT_FOUND"
  | "IDEMPOTENCY_KEY_CONFLICT"
  | "RATE_LIMITED"
  | "QUOTA_EXCEEDED"
  | "INTERNAL_ERROR";

const ERROR_STATUS: Record<ApiErrorCode, number> = {
  MISSING_API_KEY: 401,
  MALFORMED_API_KEY: 401,
  INVALID_API_KEY: 401,
  API_KEY_REVOKED: 401,
  API_KEY_EXPIRED: 401,
  INTEGRATION_INACTIVE: 401,
  INTEGRATION_EXPIRED: 401,
  FORBIDDEN_SCOPE: 403,
  SERVICE_NOT_CONFIGURED: 503,
  VALIDATION_ERROR: 400,
  NOT_FOUND: 404,
  IDEMPOTENCY_KEY_CONFLICT: 409,
  RATE_LIMITED: 429,
  QUOTA_EXCEEDED: 429,
  INTERNAL_ERROR: 500,
};

export class ApiError extends Error {
  readonly code: ApiErrorCode;
  readonly status: number;
  /** Extra response headers to merge in when this error becomes an HTTP
   * response — used by RATE_LIMITED/QUOTA_EXCEEDED to carry the
   * X-RateLimit-*, X-Quota-*, and Retry-After headers even on a rejected
   * request, so a caller always has enough information to back off
   * correctly. */
  readonly headers?: Record<string, string>;

  constructor(code: ApiErrorCode, message: string, headers?: Record<string, string>) {
    super(message);
    this.code = code;
    this.status = ERROR_STATUS[code];
    this.headers = headers;
  }
}
