import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { apiSuccess, handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { buildPageMeta, parsePaginationParams } from "@/lib/api-v1/pagination";
import { listClientsForOrg, parseClientFilters } from "@/lib/api-v1/clients";
import { toClientDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";

/** GET /api/v1/clients — paginated, org-isolated list. Query params:
 * limit (1-100, default 20), cursor, from/to (ISO 8601 bounds on
 * createdAt), stage (lead|prospect|client|churned), q (searches name/
 * contactName/email). Archived clients are never returned — see
 * lib/api-v1/clients.ts. */
export async function GET(request: Request) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "clients:read" });
    const { searchParams } = new URL(request.url);
    const { limit, cursor } = parsePaginationParams(searchParams);
    const filters = parseClientFilters(searchParams);

    const rows = await listClientsForOrg(context.organizationId, { ...filters, cursor, limit });
    const { page, nextCursor } = buildPageMeta(rows, limit);

    await logApiSuccess({ context, action: "api_v1.clients.listed", metadata: { count: page.length } });

    return apiSuccess(page.map(toClientDTO), requestId, {
      meta: { pagination: { limit, nextCursor } },
      headers: buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay),
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
