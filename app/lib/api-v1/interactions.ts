import "server-only";
import { db } from "@/db";
import { interactions } from "@/db/schema";
import { ApiError } from "@/lib/api-v1/errors";

/**
 * POST /api/v1/interactions — appends to a client's interaction log
 * (db/schema.ts:455). `clientId` is already NOT NULL in the schema
 * itself, so no API-level constraint is needed beyond verifying it
 * belongs to the caller's organization (done in the route, via
 * lib/api-v1/clients.ts's getClientForOrg — the same function Étape 3
 * uses for GET/PATCH, so "belongs to my organization" means exactly the
 * same thing everywhere in this API).
 *
 * `createdBy` is never accepted from the request body (explicitly
 * forbidden — see validateInteractionCreateBody) but the column DOES get
 * populated: createInteractionForClient sets it server-side to a
 * non-secret key identifier ("api:{keyPrefix}"), the same value already
 * safe to log (lib/api-v1/auth.ts never treats keyPrefix as sensitive).
 * This is for internal traceability only — it is NOT echoed back in
 * InteractionDTO (lib/api-v1/dto.ts), consistent with never exposing
 * PUBLIC-MAP-internal attribution through the public API.
 */

const INTERACTION_TYPES = ["call", "email", "meeting", "note"] as const;
const INTERACTION_ALLOWED_FIELDS = ["clientId", "type", "summary", "occurredAt"] as const;

export type InteractionCreateInput = {
  clientId: string;
  type: (typeof INTERACTION_TYPES)[number];
  summary: string;
  occurredAt: Date | undefined; // undefined -> let the column default ("now") apply
};

export function validateInteractionCreateBody(body: unknown): InteractionCreateInput {
  if (typeof body !== "object" || body === null || Array.isArray(body)) {
    throw new ApiError("VALIDATION_ERROR", "The request body must be a JSON object.");
  }
  const input = body as Record<string, unknown>;
  const keys = Object.keys(input);
  if (keys.length === 0) throw new ApiError("VALIDATION_ERROR", "The request body must not be empty.");

  const allowed: readonly string[] = INTERACTION_ALLOWED_FIELDS;
  const unknownKeys = keys.filter((key) => !allowed.includes(key));
  if (unknownKeys.length > 0) {
    throw new ApiError("VALIDATION_ERROR", `These fields are not allowed: ${unknownKeys.join(", ")}.`);
  }

  if (typeof input.clientId !== "string" || !input.clientId.trim()) {
    throw new ApiError("VALIDATION_ERROR", '"clientId" is required and must be a non-empty string.');
  }

  if (typeof input.type !== "string" || !(INTERACTION_TYPES as readonly string[]).includes(input.type)) {
    throw new ApiError("VALIDATION_ERROR", `"type" is required and must be one of: ${INTERACTION_TYPES.join(", ")}.`);
  }

  if (typeof input.summary !== "string" || !input.summary.trim()) {
    throw new ApiError("VALIDATION_ERROR", '"summary" is required and must be a non-empty string.');
  }

  let occurredAt: Date | undefined;
  if ("occurredAt" in input) {
    if (input.occurredAt === null) {
      throw new ApiError("VALIDATION_ERROR", '"occurredAt" cannot be null — omit it entirely to use the current time.');
    }
    if (typeof input.occurredAt !== "string") throw new ApiError("VALIDATION_ERROR", '"occurredAt" must be an ISO 8601 date string.');
    const parsed = new Date(input.occurredAt);
    if (Number.isNaN(parsed.getTime())) throw new ApiError("VALIDATION_ERROR", '"occurredAt" must be a valid ISO 8601 date.');
    occurredAt = parsed;
  }

  return {
    clientId: input.clientId.trim(),
    type: input.type as (typeof INTERACTION_TYPES)[number],
    summary: input.summary.trim(),
    occurredAt,
  };
}

export async function createInteractionForClient(clientId: string, input: InteractionCreateInput, keyPrefix: string) {
  const [interaction] = await db
    .insert(interactions)
    .values({
      clientId,
      type: input.type,
      summary: input.summary,
      createdBy: `api:${keyPrefix}`,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .returning();
  return interaction;
}
