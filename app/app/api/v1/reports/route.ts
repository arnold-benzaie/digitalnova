import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { apiSuccess, handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { buildPageMeta, parsePaginationParams } from "@/lib/api-v1/pagination";
import { getIssueCountsForAudits, listAuditsForOrg, parseAuditFilters } from "@/lib/api-v1/audits";
import { toReportListItemDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";

/** GET /api/v1/reports — same underlying data and filters as
 * GET /api/v1/audits (there is no separate "report" table — see
 * lib/api-v1/audits.ts's module docstring), but each item is the curated
 * report view: score/summary plus an issue-count breakdown by priority.
 * The full issue list is only in the :id detail route, to keep list
 * pages lean. */
export async function GET(request: Request) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "reports:read" });
    const { searchParams } = new URL(request.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const filters = parseAuditFilters(searchParams);

    const rows = await listAuditsForOrg(context.organizationId, { ...filters, cursor, limit });
    const { page, nextCursor } = buildPageMeta(rows, limit);
    const counts = await getIssueCountsForAudits(page.map((row) => row.id));

    await logApiSuccess({ context, action: "api_v1.reports.listed", metadata: { count: page.length } });

    return apiSuccess(page.map((row) => toReportListItemDTO(row, counts.get(row.id))), requestId, {
      meta: { pagination: { limit, nextCursor } },
      headers: buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay),
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
