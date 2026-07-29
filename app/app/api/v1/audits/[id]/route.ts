import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { apiSuccess, handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { ApiError } from "@/lib/api-v1/errors";
import { getAuditForOrg } from "@/lib/api-v1/audits";
import { isValidUuid, toAuditDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";

/** GET /api/v1/audits/:id — returns the SAME 404 whether the id doesn't
 * exist at all or belongs to a different organization; see
 * getAuditForOrg's docstring and SECURITY.md. A syntactically invalid id
 * (not a UUID) is a 400, not a 404 — that distinction carries no
 * information about which organizations exist or own what. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "audits:read" });
    const { id } = await params;
    if (!isValidUuid(id)) throw new ApiError("VALIDATION_ERROR", 'The audit id must be a valid UUID.');

    const row = await getAuditForOrg(context.organizationId, id);
    if (!row) throw new ApiError("NOT_FOUND", "Audit not found.");

    await logApiSuccess({ context, action: "api_v1.audits.retrieved", targetType: "audit", targetId: id });

    return apiSuccess(toAuditDTO(row), requestId, {
      headers: buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay),
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
