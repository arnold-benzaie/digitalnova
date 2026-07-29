import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { apiSuccess, handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { ApiError } from "@/lib/api-v1/errors";
import { getAuditForOrg, getAuditIssues } from "@/lib/api-v1/audits";
import { isValidUuid, toReportDetailDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";

/** GET /api/v1/reports/:id — the ":id" is an audit id (see the module
 * docstring on lib/api-v1/audits.ts); returns the full curated report
 * (score, summary, and every issue) rather than the lighter list shape.
 * Same 404-for-both-cases and UUID validation as /api/v1/audits/:id. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "reports:read" });
    const { id } = await params;
    if (!isValidUuid(id)) throw new ApiError("VALIDATION_ERROR", "The report id must be a valid UUID.");

    const row = await getAuditForOrg(context.organizationId, id);
    if (!row) throw new ApiError("NOT_FOUND", "Report not found.");
    const issues = await getAuditIssues(id);

    await logApiSuccess({ context, action: "api_v1.reports.retrieved", targetType: "audit", targetId: id });

    return apiSuccess(toReportDetailDTO(row, issues), requestId, {
      headers: buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay),
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
