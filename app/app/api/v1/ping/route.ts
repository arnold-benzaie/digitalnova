import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { apiSuccess, handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";

/**
 * Minimal route validating the full auth foundation (key parsing,
 * verification, status/scope checks, org attachment) end to end before
 * any real business route exists. Requires no scope — any active,
 * non-expired key on an active integration can call it. Deliberately the
 * ONLY /api/v1 route in this stage; audits/clients/tasks/interactions
 * are built in later stages on top of this foundation.
 */
export async function GET(request: Request) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request);
    return apiSuccess(
      { pong: true, organizationId: context.organizationId, scopes: context.scopes },
      requestId,
      { headers: buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay) },
    );
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
