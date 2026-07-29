import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { apiSuccess, handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { ApiError } from "@/lib/api-v1/errors";
import { getClientForOrg, updateClientForOrg, validateClientPatchBody } from "@/lib/api-v1/clients";
import { isValidUuid, toClientDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";

/** GET /api/v1/clients/:id — same 404 whether the id doesn't exist,
 * belongs to another organization, or is archived. */
export async function GET(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "clients:read" });
    const { id } = await params;
    if (!isValidUuid(id)) throw new ApiError("VALIDATION_ERROR", "The client id must be a valid UUID.");

    const row = await getClientForOrg(context.organizationId, id);
    if (!row) throw new ApiError("NOT_FOUND", "Client not found.");

    await logApiSuccess({ context, action: "api_v1.clients.retrieved", targetType: "crm_client", targetId: id });

    return apiSuccess(toClientDTO(row), requestId, {
      headers: buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay),
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}

/** PATCH /api/v1/clients/:id — only lib/api-v1/clients.ts's
 * CLIENT_PATCHABLE_FIELDS (name, contactName, email, phone, address) can
 * ever be set; validateClientPatchBody rejects the whole request (400)
 * if the body is empty, malformed, or names any other field —
 * organizationId/id/stage/source/ownerName/notes/archivedAt/createdAt
 * can never be touched through this route. The update is scoped by id
 * AND organizationId in the same query, so a cross-organization id
 * simply matches zero rows and is treated as NOT_FOUND, identically to
 * GET. Only the names of the changed fields are logged — never their new
 * values, which could be personal data (email/phone/address). */
export async function PATCH(request: Request, { params }: { params: Promise<{ id: string }> }) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "clients:update" });
    const { id } = await params;
    if (!isValidUuid(id)) throw new ApiError("VALIDATION_ERROR", "The client id must be a valid UUID.");

    let body: unknown;
    try {
      body = await request.json();
    } catch {
      throw new ApiError("VALIDATION_ERROR", "The request body must be valid JSON.");
    }
    const patch = validateClientPatchBody(body);

    const row = await updateClientForOrg(context.organizationId, id, patch);
    if (!row) throw new ApiError("NOT_FOUND", "Client not found.");

    await logApiSuccess({
      context,
      action: "api_v1.clients.updated",
      targetType: "crm_client",
      targetId: id,
      metadata: { fields: Object.keys(patch) },
    });

    return apiSuccess(toClientDTO(row), requestId, {
      headers: buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay),
    });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
