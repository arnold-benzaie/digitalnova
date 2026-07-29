import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { ApiError } from "@/lib/api-v1/errors";
import { getClientForOrg } from "@/lib/api-v1/clients";
import { createInteractionForClient, validateInteractionCreateBody } from "@/lib/api-v1/interactions";
import { toInteractionDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";
import { checkIdempotency, extractIdempotencyKey, hashRequestBody, recordIdempotentResponse } from "@/lib/api-v1/idempotency";

const ROUTE = "POST /api/v1/interactions";

/** POST /api/v1/interactions — see lib/api-v1/interactions.ts for the
 * exact whitelist. Same clientId-ownership check, same anti-enumeration
 * VALIDATION_ERROR, same Idempotency-Key support as /api/v1/tasks. */
export async function POST(request: Request) {
  const requestId = generateApiRequestId();
  try {
    const context = await authenticateApiRequest(request, { requiredScope: "interactions:create" });
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

    const input = validateInteractionCreateBody(rawBody);
    const client = await getClientForOrg(context.organizationId, input.clientId);
    if (!client) throw new ApiError("VALIDATION_ERROR", '"clientId" does not reference a client in your organization.');

    const interaction = await createInteractionForClient(client.id, input, context.keyPrefix);
    const dto = toInteractionDTO(interaction);

    await logApiSuccess({ context, action: "api_v1.interactions.created", targetType: "interaction", targetId: interaction.id, metadata: { clientId: client.id } });

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
