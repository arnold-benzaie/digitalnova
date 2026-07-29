import "server-only";
import { createHash } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { integrationApiIdempotencyKeys } from "@/db/schema";
import { ApiError } from "@/lib/api-v1/errors";

/**
 * Idempotency for /api/v1 write routes (`Idempotency-Key` header),
 * backed by `integration_api_idempotency_keys` (db/schema.ts, migration
 * 0015 — generated but, as of this stage, applied only to the local
 * Docker test database, never Preview or Production).
 *
 * Scope and semantics:
 * - Keyed by (integrationId, route, idempotencyKey) — integrationId
 *   rather than apiKeyId so a key rotation doesn't break idempotency
 *   continuity; route is part of the key so the same string reused on
 *   two different write routes can never collide.
 * - A retry with the SAME key and the SAME request body replays the
 *   original response verbatim (same status, same JSON body) — the
 *   caller gets back the exact resource created the first time, not a
 *   new one.
 * - A retry with the SAME key and a DIFFERENT request body is rejected
 *   with IDEMPOTENCY_KEY_CONFLICT (409) — never silently applied.
 * - Only SUCCESSFUL (2xx) responses are recorded for replay. A request
 *   that failed validation is not cached — retrying it (even with the
 *   same key) re-validates from scratch and fails the same way if
 *   nothing changed, which is simpler and avoids caching a stale error
 *   shape.
 *
 * Known limitation, stated plainly rather than overclaimed: this is a
 * check-then-act design with a unique-constraint fallback for the
 * INSERT race (see recordIdempotentResponse) — it reliably prevents
 * duplicate creation on sequential retries (the realistic case: a
 * caller's HTTP client times out before seeing the response and retries
 * the same request), but two genuinely simultaneous requests with the
 * same key can both pass the initial check and both create a resource
 * before the unique constraint is hit. Closing that fully would need a
 * two-phase "reserve, then create" design; not built in this stage.
 */

const MAX_IDEMPOTENCY_KEY_LENGTH = 200;

/** Recursively sorts object keys before serializing — plain
 * `JSON.stringify` preserves insertion order, so two requests with
 * identical VALUES but differently-ordered JSON keys (a realistic case:
 * different retry logic, a proxy that re-serializes the body, etc.)
 * would otherwise hash differently and be wrongly treated as "different
 * content". Array order is preserved (it's meaningful); only object key
 * order is normalized. */
function canonicalize(value: unknown): unknown {
  if (Array.isArray(value)) return value.map(canonicalize);
  if (value && typeof value === "object") {
    const sorted: Record<string, unknown> = {};
    for (const key of Object.keys(value as Record<string, unknown>).sort()) {
      sorted[key] = canonicalize((value as Record<string, unknown>)[key]);
    }
    return sorted;
  }
  return value;
}

export function hashRequestBody(body: unknown): string {
  return createHash("sha256").update(JSON.stringify(canonicalize(body ?? null))).digest("hex");
}

/** Returns null if no key was sent (idempotency is opt-in, not
 * mandatory, per the plan). Throws VALIDATION_ERROR for a present-but-
 * unusable header, never silently truncates or ignores it. */
export function extractIdempotencyKey(request: Request): string | null {
  const raw = request.headers.get("idempotency-key");
  if (raw === null) return null;
  const trimmed = raw.trim();
  if (!trimmed) return null;
  if (trimmed.length > MAX_IDEMPOTENCY_KEY_LENGTH) {
    throw new ApiError("VALIDATION_ERROR", `"Idempotency-Key" must be at most ${MAX_IDEMPOTENCY_KEY_LENGTH} characters.`);
  }
  return trimmed;
}

export type IdempotencyReplay = { status: number; body: unknown };

async function findExisting(integrationId: string, route: string, idempotencyKey: string) {
  const [row] = await db
    .select()
    .from(integrationApiIdempotencyKeys)
    .where(
      and(
        eq(integrationApiIdempotencyKeys.integrationId, integrationId),
        eq(integrationApiIdempotencyKeys.route, route),
        eq(integrationApiIdempotencyKeys.idempotencyKey, idempotencyKey),
      ),
    )
    .limit(1);
  return row ?? null;
}

function assertMatchesOrConflict(existing: { requestHash: string; responseStatus: number; responseBody: unknown }, requestHash: string): IdempotencyReplay {
  if (existing.requestHash !== requestHash) {
    throw new ApiError("IDEMPOTENCY_KEY_CONFLICT", "This Idempotency-Key was already used with a different request body.");
  }
  return { status: existing.responseStatus, body: existing.responseBody };
}

/** Call before doing any work. Returns the response to replay verbatim
 * if this exact key+route+body combination already succeeded; throws
 * IDEMPOTENCY_KEY_CONFLICT if the key was reused with different content;
 * returns null if this is genuinely new (proceed, then call
 * recordIdempotentResponse once the resource is created). */
export async function checkIdempotency(integrationId: string, route: string, idempotencyKey: string, requestHash: string): Promise<IdempotencyReplay | null> {
  const existing = await findExisting(integrationId, route, idempotencyKey);
  if (!existing) return null;
  return assertMatchesOrConflict(existing, requestHash);
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

/** Call once the resource has actually been created. If a concurrent
 * request already recorded this exact key first (unique-constraint
 * race), returns/validates against THAT row instead of throwing — every
 * caller ends up with a consistent view either way. */
export async function recordIdempotentResponse(
  integrationId: string,
  route: string,
  idempotencyKey: string,
  requestHash: string,
  responseStatus: number,
  responseBody: unknown,
): Promise<IdempotencyReplay> {
  try {
    await db.insert(integrationApiIdempotencyKeys).values({ integrationId, route, idempotencyKey, requestHash, responseStatus, responseBody });
    return { status: responseStatus, body: responseBody };
  } catch (error) {
    if ((error as { code?: string } | null)?.code === POSTGRES_UNIQUE_VIOLATION) {
      const existing = await findExisting(integrationId, route, idempotencyKey);
      if (existing) return assertMatchesOrConflict(existing, requestHash);
    }
    throw error;
  }
}
