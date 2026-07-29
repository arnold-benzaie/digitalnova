import "server-only";
import { ApiError, type ApiErrorCode } from "@/lib/api-v1/errors";

/**
 * Normalized response envelope for /api/v1/* — the first such convention
 * in this repo (existing app/api/** routes each return ad hoc plain-text
 * error bodies and inconsistent success keys; see SECURITY.md for the
 * survey). Every /api/v1 response carries an X-Request-Id header; error
 * bodies additionally echo it in error.requestId, since that's the field
 * an external caller (n8n, Zapier, a support ticket) will actually quote
 * back to us.
 */

export type ApiErrorBody = {
  error: { code: ApiErrorCode; message: string; requestId: string };
};

export function apiSuccess<T>(
  data: T,
  requestId: string,
  init?: { status?: number; meta?: Record<string, unknown>; headers?: Record<string, string> },
): Response {
  const body = { data, ...(init?.meta ?? {}) };
  return Response.json(body, {
    status: init?.status ?? 200,
    headers: { "X-Request-Id": requestId, ...(init?.headers ?? {}) },
  });
}

export function apiError(code: ApiErrorCode, message: string, status: number, requestId: string, headers?: Record<string, string>): Response {
  const body: ApiErrorBody = { error: { code, message, requestId } };
  return Response.json(body, {
    status,
    headers: { "X-Request-Id": requestId, ...(headers ?? {}) },
  });
}

/**
 * Every /api/v1 route handler should be a thin wrapper: generate a
 * request id, try the real work, and pass any thrown error through here.
 * ApiError (and its ApiAuthError subtype) carries its own code/status,
 * and — for RATE_LIMITED/QUOTA_EXCEEDED — its own extra headers
 * (X-RateLimit-*, X-Quota-*, Retry-After, see lib/api-v1/rate-limit.ts),
 * which are passed through unchanged. Anything else becomes a generic
 * 500 with no internal detail leaked to the caller.
 */
export function handleApiError(error: unknown, requestId: string): Response {
  if (error instanceof ApiError) {
    return apiError(error.code, error.message, error.status, requestId, error.headers);
  }
  console.error(`[api/v1] unhandled error (requestId=${requestId}):`, error);
  return apiError("INTERNAL_ERROR", "An unexpected error occurred.", 500, requestId);
}
