import "server-only";
import { db } from "@/db";
import { and, eq } from "drizzle-orm";
import { deals, interactions } from "@/db/schema";
import { ApiError } from "@/lib/api-v1/errors";
import { isValidUuid } from "@/lib/api-v1/dto";

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
const INTERACTION_ALLOWED_FIELDS = ["clientId", "type", "summary", "occurredAt", "dealId"] as const;

export type InteractionCreateInput = {
  clientId: string;
  type: (typeof INTERACTION_TYPES)[number];
  summary: string;
  occurredAt: Date | undefined; // undefined -> let the column default ("now") apply
  dealId: string | null; // 4F.8.4/4F.8.5 — absent or null -> general client interaction
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

  // 4F.8.5 — optional deal link. Absent or null = general client interaction;
  // otherwise a UUID string (format only here — whether it is a deal of THIS
  // client is checked by assertDealBelongsToClient once the client is resolved).
  let dealId: string | null = null;
  if (input.dealId !== undefined && input.dealId !== null) {
    if (typeof input.dealId !== "string" || !isValidUuid(input.dealId)) {
      throw new ApiError("VALIDATION_ERROR", '"dealId" must be a valid UUID or null.');
    }
    dealId = input.dealId;
  }

  return {
    clientId: input.clientId.trim(),
    type: input.type as (typeof INTERACTION_TYPES)[number],
    summary: input.summary.trim(),
    occurredAt,
    dealId,
  };
}

/**
 * 4F.8.5 — a non-null dealId must be a deal of the (already organization-
 * scoped) client: organization -> client -> deal. The deal is only ever
 * looked up together with that clientId, so an unknown deal, a deal of
 * another client of the same organization and a deal of another
 * organization all get the same VALIDATION_ERROR — nothing distinguishes
 * them. No query at all when dealId is null.
 */
export async function assertDealBelongsToClient(clientId: string, dealId: string | null): Promise<void> {
  if (dealId === null) return;
  const [deal] = await db
    .select({ id: deals.id })
    .from(deals)
    .where(and(eq(deals.id, dealId), eq(deals.clientId, clientId)))
    .limit(1);
  if (!deal) throw new ApiError("VALIDATION_ERROR", '"dealId" does not reference a deal of this client.');
}

/**
 * P1 fix (2026-10): accepts an optional executor so the caller
 * (app/api/v1/interactions/route.ts, via lib/api-v1/idempotency.ts's
 * runIdempotently) can run this INSIDE the same transaction as its
 * idempotency-key claim — required for the claim-before-create race fix
 * to actually be atomic. Defaults to the bare `db`, so every other
 * caller (there are none today, but the default keeps this
 * non-breaking) behaves exactly as before.
 */
export async function createInteractionForClient(
  clientId: string,
  input: InteractionCreateInput,
  keyPrefix: string,
  executor: Pick<typeof db, "insert"> = db,
) {
  const [interaction] = await executor
    .insert(interactions)
    .values({
      clientId,
      dealId: input.dealId,
      type: input.type,
      summary: input.summary,
      createdBy: `api:${keyPrefix}`,
      ...(input.occurredAt ? { occurredAt: input.occurredAt } : {}),
    })
    .returning();
  return interaction;
}
