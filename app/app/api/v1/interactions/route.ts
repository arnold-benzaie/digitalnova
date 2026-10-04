import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { ApiError } from "@/lib/api-v1/errors";
import { getClientForOrg } from "@/lib/api-v1/clients";
import { createInteractionForClient, validateInteractionCreateBody } from "@/lib/api-v1/interactions";
import { toInteractionDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";
import { checkIdempotency, extractIdempotencyKey, hashRequestBody, runIdempotently } from "@/lib/api-v1/idempotency";

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

    // P1 fix: when an Idempotency-Key is present, the claim (against the
    // key) and the interaction creation happen inside the SAME
    // transaction, via runIdempotently — see lib/api-v1/idempotency.ts
    // for why this is what actually closes the concurrent-duplicate-
    // creation race (the checkIdempotency() call above is only a
    // fast-path, not the safety mechanism). Without a key, behavior is
    // byte-for-byte unchanged.
    if (idempotencyKey) {
      const result = await runIdempotently(context.integrationId, ROUTE, idempotencyKey, requestHash!, async (executor) => {
        const interaction = await createInteractionForClient(client.id, input, context.keyPrefix, executor);
        const dto = toInteractionDTO(interaction);
        await logApiSuccess({ context, action: "api_v1.interactions.created", targetType: "interaction", targetId: interaction.id, metadata: { clientId: client.id } });
        return { status: 201, body: { data: dto } };
      });
      return Response.json(result.body, { status: result.status, headers: { "X-Request-Id": requestId, ...usageHeaders } });
    }

    const interaction = await createInteractionForClient(client.id, input, context.keyPrefix);
    const dto = toInteractionDTO(interaction);
    await logApiSuccess({ context, action: "api_v1.interactions.created", targetType: "interaction", targetId: interaction.id, metadata: { clientId: client.id } });

    return Response.json({ data: dto }, { status: 201, headers: { "X-Request-Id": requestId, ...usageHeaders } });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
