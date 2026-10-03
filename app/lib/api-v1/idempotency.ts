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
 * P1 fix (2026-10): the two callers (app/api/v1/tasks,
 * app/api/v1/interactions) still call checkIdempotency() first as a
 * fast-path (replay without even validating the body or looking up the
 * client, for the common sequential-retry-after-success case), but the
 * actual resource creation now goes through runIdempotently() below
 * instead of a bare create + recordIdempotentResponse pair. That closes
 * the race documented below: the loser of a genuinely concurrent pair
 * never calls its own resource-creation function at all.
 *
 * How the race is actually closed (no migration, no new column, the
 * EXISTING unique index on (integrationId, route, idempotencyKey) is the
 * only mechanism): runIdempotently() opens a transaction and INSERTs a
 * claim row for this key BEFORE calling the caller's resource-creation
 * callback. Postgres's own unique-index enforcement blocks a second,
 * concurrent INSERT of the same key until the FIRST transaction either
 * commits or rolls back — there is no observable "pending" window for a
 * concurrent reader to race into, because nothing commits until the
 * whole claim+create+finalize sequence has already succeeded. A losing
 * transaction's INSERT only returns (with the unique-violation error)
 * once the winner's transaction has fully concluded, so by the time the
 * loser reads the row back, it is guaranteed to reflect the winner's
 * FINAL, already-committed response (or to not exist at all, if the
 * winner rolled back — in which case the "loser" simply becomes the new
 * winner). This is why no "pending"/intermediate status needs to be
 * invented: Postgres's existing concurrency control already provides it.
 *
 * `responseStatus`/`responseBody` are NOT NULL (unchanged, no schema
 * edit) — the claim row is inserted with the sentinel placeholder values
 * below, then UPDATEd to the real response in the SAME transaction once
 * the resource actually exists. Those placeholder values are never
 * externally observable (see the paragraph above: nothing commits until
 * they've already been overwritten), but a clearly-sentinel shape is
 * still used defensively (status 0 is never a real HTTP status).
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

async function findExisting(
  executor: Pick<typeof db, "select">,
  integrationId: string,
  route: string,
  idempotencyKey: string,
) {
  const [row] = await executor
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
 * returns null if this is genuinely new — in that case, proceed to
 * runIdempotently() below (never a bare create here). This early check
 * is a pure fast-path optimization (skip validation/lookups entirely for
 * the common sequential-retry-after-success case); it is NOT what makes
 * concurrent calls safe — runIdempotently() is. */
export async function checkIdempotency(integrationId: string, route: string, idempotencyKey: string, requestHash: string): Promise<IdempotencyReplay | null> {
  const existing = await findExisting(db, integrationId, route, idempotencyKey);
  if (!existing) return null;
  return assertMatchesOrConflict(existing, requestHash);
}

const POSTGRES_UNIQUE_VIOLATION = "23505";

// drizzle-orm's node-postgres driver wraps every query failure in its own
// DrizzleQueryError, whose OWN `.code` is always undefined — the real
// driver error (a `pg` DatabaseError, which does carry `.code`) is
// preserved on `.cause` (confirmed in node_modules/drizzle-orm/errors.ts).
// Checking `error.code` alone (the original, pre-P1 code did this) never
// matches, so the unique-violation branch below would never be taken —
// confirmed by a genuine concurrent-request reproduction, where the
// loser's claim-row insert surfaced as an uncaught 500 instead of
// replaying the winner's response. Checking both shapes is defensive:
// `.code` for a raw driver error (if one is ever thrown directly), `.cause.code`
// for drizzle's wrapper (the actual shape observed in practice).
function isPostgresUniqueViolation(error: unknown): boolean {
  if (!error || typeof error !== "object") return false;
  if ((error as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION) return true;
  const cause = (error as { cause?: unknown }).cause;
  return Boolean(cause && typeof cause === "object" && (cause as { code?: string }).code === POSTGRES_UNIQUE_VIOLATION);
}

// Never a real HTTP status (every real one is >= 100) — marks a claim
// row as "resource creation still in progress inside this transaction".
// Never externally observable: nothing commits until these are already
// overwritten by the real response (see this file's header comment) —
// kept as a clearly-sentinel shape purely for defensive clarity.
const CLAIM_IN_PROGRESS_STATUS = 0;
const CLAIM_IN_PROGRESS_BODY = { claimInProgress: true } as const;

/**
 * Runs `createResource` at most once for a given (integrationId, route,
 * idempotencyKey) combination — including under genuine concurrency, not
 * just sequential retries. See this file's header comment for exactly
 * how (claim-before-create, using the EXISTING unique index as the sole
 * race-resolution mechanism — no migration, no new column, no invented
 * "pending" status beyond the two sentinel constants above).
 *
 * `createResource` receives the SAME transaction executor used for the
 * claim — it MUST perform the actual resource creation (and anything
 * else that needs to roll back together with it) through that executor,
 * never through the bare `db`, or the atomicity this function exists to
 * provide is lost.
 *
 * - Brand new key: claims it, runs `createResource`, records the real
 *   response in the same transaction, returns it.
 * - Same key + same body (sequential retry, OR the loser of a genuine
 *   race): returns the winner's already-committed response verbatim —
 *   `createResource` is never called.
 * - Same key + different body: throws IDEMPOTENCY_KEY_CONFLICT —
 *   `createResource` is never called.
 * - `createResource` itself throws: the whole transaction (claim row
 *   included) rolls back — nothing is left behind, and a subsequent
 *   call with the same key starts completely fresh, as if the first
 *   attempt had never happened.
 *
 * Implementation note: the unique-violation catch is OUTSIDE the
 * `db.transaction(...)` call, not inside it. Postgres aborts an entire
 * transaction block as soon as any one statement in it errors — once the
 * claim INSERT raises 23505, that same transaction cannot run even a
 * plain SELECT afterwards (it fails with `25P02 current transaction is
 * aborted`); this was confirmed empirically via a genuine concurrent
 * reproduction, not just reasoned about. drizzle's own `transaction()`
 * (node-postgres driver) already issues ROLLBACK and releases the
 * connection before rethrowing on any error — see node_modules/
 * drizzle-orm/node-postgres/session.js — so by the time this function's
 * catch block runs, the loser's transaction is fully and safely rolled
 * back, and re-querying with the bare `db` (a fresh pooled connection)
 * for the winner's now-final committed row is safe.
 */
export async function runIdempotently<T>(
  integrationId: string,
  route: string,
  idempotencyKey: string,
  requestHash: string,
  createResource: (executor: Pick<typeof db, "insert">) => Promise<{ status: number; body: T }>,
): Promise<IdempotencyReplay> {
  try {
    return await db.transaction(async (tx) => {
      await tx.insert(integrationApiIdempotencyKeys).values({
        integrationId,
        route,
        idempotencyKey,
        requestHash,
        responseStatus: CLAIM_IN_PROGRESS_STATUS,
        responseBody: CLAIM_IN_PROGRESS_BODY,
      });

      const result = await createResource(tx);

      await tx
        .update(integrationApiIdempotencyKeys)
        .set({ responseStatus: result.status, responseBody: result.body })
        .where(
          and(
            eq(integrationApiIdempotencyKeys.integrationId, integrationId),
            eq(integrationApiIdempotencyKeys.route, route),
            eq(integrationApiIdempotencyKeys.idempotencyKey, idempotencyKey),
          ),
        );

      return result;
    });
  } catch (error) {
    if (isPostgresUniqueViolation(error)) {
      // Postgres raises this only once the OTHER transaction that
      // claimed the key first has fully committed or rolled back (its
      // own INSERT blocked ours until then) — the row read below is
      // therefore guaranteed to already be in its FINAL state, never
      // the in-progress sentinel above.
      const existing = await findExisting(db, integrationId, route, idempotencyKey);
      if (existing) return assertMatchesOrConflict(existing, requestHash);
    }
    throw error;
  }
}
