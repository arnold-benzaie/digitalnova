import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { ApiError } from "@/lib/api-v1/errors";
import { getClientForOrg } from "@/lib/api-v1/clients";
import { createTaskForClient, validateTaskCreateBody } from "@/lib/api-v1/tasks";
import { toTaskDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";
import { checkIdempotency, extractIdempotencyKey, hashRequestBody, recordIdempotentResponse } from "@/lib/api-v1/idempotency";

const ROUTE = "POST /api/v1/tasks";

/** POST /api/v1/tasks — see lib/api-v1/tasks.ts for the exact whitelist
 * and why `clientId` is required. `clientId` is validated against the
 * SAME getClientForOrg used by GET/PATCH /clients (Étape 3) — "belongs to
 * my organization" means one thing everywhere in this API, and an
 * invalid/foreign clientId gets a generic VALIDATION_ERROR that never
 * distinguishes "doesn't exist" from "not yours" (same anti-enumeration
 * principle as the 404s elsewhere). Supports `Idempotency-Key` — see
 * lib/api-v1/idempotency.ts. */
export async function POST(request: Request) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "tasks:create" });
    const usageHeaders = buildUsageHeaders(context.rateLimit.perMinute, context.rateLimit.perDay);

    let rawBody: unknown;
    try {
      rawBody = await request.json();
    } catch {
      throw new ApiError("VALIDATION_ERROR", "The request body must be valid JSON.");
    }

    const idempotencyKey = extractIdempotencyKey(request);
    const requestHash = idempotencyKey ? hashRequestBody(rawBody) : null;
    if (idempotencyKey) {
      const replay = await checkIdempotency(context.integrationId, ROUTE, idempotencyKey, requestHash!);
      if (replay) return Response.json(replay.body, { status: replay.status, headers: { "X-Request-Id": requestId, ...usageHeaders } });
    }

    const input = validateTaskCreateBody(rawBody);
    const client = await getClientForOrg(context.organizationId, input.clientId);
    if (!client) throw new ApiError("VALIDATION_ERROR", '"clientId" does not reference a client in your organization.');

    const task = await createTaskForClient(client.id, input);
    const dto = toTaskDTO(task);

    await logApiSuccess({ context, action: "api_v1.tasks.created", targetType: "task", targetId: task.id, metadata: { clientId: client.id } });

    const responseBody = { data: dto };
    if (idempotencyKey) {
      const recorded = await recordIdempotentResponse(context.integrationId, ROUTE, idempotencyKey, requestHash!, 201, responseBody);
      return Response.json(recorded.body, { status: recorded.status, headers: { "X-Request-Id": requestId, ...usageHeaders } });
    }

    return Response.json(responseBody, { status: 201, headers: { "X-Request-Id": requestId, ...usageHeaders } });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
