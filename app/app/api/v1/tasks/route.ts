import { authenticateApiRequest, generateApiRequestId } from "@/lib/api-v1/auth";
import { handleApiError } from "@/lib/api-v1/response";
import { buildUsageHeaders } from "@/lib/api-v1/rate-limit";
import { ApiError } from "@/lib/api-v1/errors";
import { getClientForOrg } from "@/lib/api-v1/clients";
import { createTaskForClient, validateTaskCreateBody } from "@/lib/api-v1/tasks";
import { toTaskDTO } from "@/lib/api-v1/dto";
import { logApiSuccess } from "@/lib/api-v1/logging";
import { checkIdempotency, extractIdempotencyKey, hashRequestBody, runIdempotently } from "@/lib/api-v1/idempotency";

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

    // P1 fix: when an Idempotency-Key is present, the claim (against the
    // key) and the task creation happen inside the SAME transaction, via
    // runIdempotently — see lib/api-v1/idempotency.ts for why this is
    // what actually closes the concurrent-duplicate-creation race (the
    // checkIdempotency() call above is only a fast-path, not the safety
    // mechanism). Without a key, behavior is byte-for-byte unchanged.
    if (idempotencyKey) {
      const result = await runIdempotently(context.integrationId, ROUTE, idempotencyKey, requestHash!, async (executor) => {
        const task = await createTaskForClient(client.id, input, executor);
        const dto = toTaskDTO(task);
        await logApiSuccess({ context, action: "api_v1.tasks.created", targetType: "task", targetId: task.id, metadata: { clientId: client.id } });
        return { status: 201, body: { data: dto } };
      });
      return Response.json(result.body, { status: result.status, headers: { "X-Request-Id": requestId, ...usageHeaders } });
    }

    const task = await createTaskForClient(client.id, input);
    const dto = toTaskDTO(task);
    await logApiSuccess({ context, action: "api_v1.tasks.created", targetType: "task", targetId: task.id, metadata: { clientId: client.id } });

    return Response.json({ data: dto }, { status: 201, headers: { "X-Request-Id": requestId, ...usageHeaders } });
  } catch (error) {
    return handleApiError(error, requestId);
  }
}
