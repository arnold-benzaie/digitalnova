import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { apiSuccess, handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { buildPageMeta, parsePaginationParams } from "@/lib/api-v1/pagination";
import { listAuditsForOrg, parseAuditFilters } from "@/lib/api-v1/audits";
import { toAuditDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";

/** GET /api/v1/audits — paginated, org-isolated list. Query params:
 * limit (1-100, default 20), cursor (opaque, from a previous page's
 * nextCursor), from/to (ISO 8601 date bounds on createdAt), q (searches
 * summary). See lib/api-v1/audits.ts's parseAuditFilters for why there is
 * no "status" filter. */
export async function GET(request: Request) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "audits:read" });
    const { searchParams } = new URL(request.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const filters = parseAuditFilters(searchParams);

    const rows = await listAuditsForOrg(context.organizationId, { ...filters, cursor, limit });
    const { page, nextCursor } = buildPageMeta(rows, limit);

    await logApiSuccess({ context, action: "api_v1.audits.listed", metadata: { count: page.length } });

    return apiSuccess(page.map(toAuditDTO), requestId, {
      meta: { pagination: { limit, nextCursor } },
      headers: buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay),
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
