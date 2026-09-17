import "server-only";

/**
 * RADAR DISCOVERY ENGINE — Phase B — the ONLY module that writes to
 * `discovery_results` (db/schema.ts). This is the staging/provenance
 * layer for a future external prospect-discovery pipeline; see that
 * table's own docstring for the full architecture rationale (why no
 * provider is coupled here, why there is no organizationId, why there is
 * no raw-payload column, why (source, sourceId) — not name/phone/
 * website/geography — is the only uniqueness guarantee).
 *
 * WHAT THIS PHASE DOES NOT DO:
 *  - no provider adapter, no ingestion pipeline, no server action exposed
 *    to a page/UI;
 *  - no conversion to crm_clients — `crmClientId` is structurally
 *    impossible to set through this module (DiscoveryResultInput has no
 *    such field at all), and no function here ever writes it. A future,
 *    separately authorized phase owns that write.
 *
 * MISSION C-2D-4-E — ENRICHMENT ENGINE WRITE-PATH. `createDiscoveryResult()`
 * above remains exactly as originally built: identity-only, always starts
 * a row at "discovered", never refreshes an existing row. Enrichment is a
 * GENUINELY SEPARATE write path, added below, split into three
 * independent, SHORT-LIVED operations specifically so no Postgres
 * transaction (and no held connection) ever spans the network round trip
 * to Google — see this file's own "CLAIM / LEASE" section header for the
 * full rationale (this was an explicit, mandatory correction to the prior
 * C-2D-4-D design's `BEGIN -> SELECT FOR UPDATE -> HTTP -> UPDATE ->
 * COMMIT` sketch, which this mission's own spec calls out as forbidden):
 *
 *   1. claimDiscoveryResultForEnrichment()   — one short, atomic UPDATE.
 *      Transaction-free (a single statement is already atomic); ends
 *      before any network call is ever made.
 *   2. (the caller performs the Google Details HTTP call here, with
 *      ZERO database connection held)
 *   3. finalizeDiscoveryResultEnrichment()   — one short transaction:
 *      re-verify the lease, merge, transition status, write updatedAt,
 *      audit, release the lease — all atomically, but only ever open for
 *      the duration of local DB writes, never a network call.
 *   4. releaseDiscoveryResultEnrichmentClaim() — the FAILURE-path
 *      counterpart of (3): releases the lease immediately when step 2
 *      fails, rather than waiting for the lease to expire naturally.
 *
 * DEFENSE IN DEPTH (mirrors provider-attempt-telemetry-store.ts's own
 * discipline): every field is validated/normalized here before it ever
 * reaches a query; the insert always builds a hand-written literal
 * object from validated values, never a spread of the raw input, so a
 * stray extra property on the caller's object can never reach a column
 * it was never meant to. Unlike that telemetry store, this one is NOT
 * best-effort — a discovery result is meaningful data a future pipeline
 * depends on, so a genuine failure (invalid input, a DB error) is thrown
 * to the caller rather than silently dropped.
 */
import { and, eq, isNull, lt, ne, or } from "drizzle-orm";
import { db } from "@/db";
import { discoveryResults } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import type { DiscoveryDetailsResult } from "./types";

export const DISCOVERY_RESULT_STATUSES = ["discovered", "enriched", "converted", "ignored"] as const;
export type DiscoveryResultStatus = (typeof DISCOVERY_RESULT_STATUSES)[number];

export type DiscoveryResultRow = typeof discoveryResults.$inferSelect;

/**
 * Everything a future provider adapter could supply about ONE discovered
 * establishment. Deliberately has NO `status` and NO `crmClientId` field
 * at all — both are exclusively store-controlled (see this file's own
 * header) — so a caller cannot even attempt to set them, structurally,
 * not just by convention.
 */
export type DiscoveryResultInput = {
  source: string;
  sourceId: string;
  sourceUrl?: string | null;
  name: string;
  category?: string | null;
  address?: string | null;
  country?: string | null;
  region?: string | null;
  city?: string | null;
  postalCode?: string | null;
  phone?: string | null;
  email?: string | null;
  website?: string | null;
  /** Must be a finite number in [-90, 90] when provided — validated here
   * in addition to the DB's own CHECK constraint (defense in depth). */
  latitude?: number | null;
  /** Must be a finite number in [-180, 180] when provided. */
  longitude?: number | null;
  /** Raw provider-supplied string, never validated against the IANA tz
   * database and never derived from country — see the table's own
   * docstring. */
  timezone?: string | null;
  /** A small, structured weekly-hours value when a future provider
   * supplies one — never an arbitrary/raw provider payload (see the
   * table's own docstring on why this is not a "raw payload" exception).
   * Untyped here on purpose: no provider exists yet to anchor a real
   * shape against. */
  openingHours?: unknown;
};

function requiredTrimmed(value: string, field: string): string {
  if (typeof value !== "string") throw new Error(`discovery_results: ${field} is required`);
  const trimmed = value.trim();
  if (trimmed === "") throw new Error(`discovery_results: ${field} must not be empty`);
  return trimmed;
}

function optionalTrimmed(value: string | null | undefined): string | null {
  if (typeof value !== "string") return null;
  const trimmed = value.trim();
  return trimmed === "" ? null : trimmed;
}

function safeCoordinate(value: number | null | undefined, min: number, max: number, field: string): number | null {
  if (value === null || value === undefined) return null;
  if (typeof value !== "number" || !Number.isFinite(value)) {
    throw new Error(`discovery_results: ${field} must be a finite number`);
  }
  if (value < min || value > max) {
    throw new Error(`discovery_results: ${field} out of range [${min}, ${max}]`);
  }
  return value;
}

/**
 * Inserts a new discovery result, or — when a row for the exact same
 * (source, sourceId) already exists — returns that existing row instead
 * of throwing a raw unique-violation or silently creating a duplicate
 * (mission section 10). This is an IDENTITY operation only: it never
 * refreshes/overwrites the fields of an existing row (no enrichment
 * logic exists in this phase) — `created: false` tells the caller
 * exactly that nothing was written.
 *
 * Always starts a row at status "discovered" with crmClientId null —
 * neither can be overridden by the caller (see DiscoveryResultInput's
 * own docstring).
 */
export async function createDiscoveryResult(input: DiscoveryResultInput): Promise<{ result: DiscoveryResultRow; created: boolean }> {
  const source = requiredTrimmed(input.source, "source");
  const sourceId = requiredTrimmed(input.sourceId, "sourceId");
  const name = requiredTrimmed(input.name, "name");

  const values = {
    source,
    sourceId,
    name,
    sourceUrl: optionalTrimmed(input.sourceUrl),
    category: optionalTrimmed(input.category),
    address: optionalTrimmed(input.address),
    country: optionalTrimmed(input.country),
    region: optionalTrimmed(input.region),
    city: optionalTrimmed(input.city),
    postalCode: optionalTrimmed(input.postalCode),
    phone: optionalTrimmed(input.phone),
    email: optionalTrimmed(input.email),
    website: optionalTrimmed(input.website),
    latitude: safeCoordinate(input.latitude, -90, 90, "latitude"),
    longitude: safeCoordinate(input.longitude, -180, 180, "longitude"),
    timezone: optionalTrimmed(input.timezone),
    openingHours: input.openingHours ?? null,
  };

  const inserted = await db
    .insert(discoveryResults)
    .values(values)
    .onConflictDoNothing({ target: [discoveryResults.source, discoveryResults.sourceId] })
    .returning();

  if (inserted.length > 0) {
    return { result: inserted[0], created: true };
  }

  const [existing] = await db
    .select()
    .from(discoveryResults)
    .where(and(eq(discoveryResults.source, source), eq(discoveryResults.sourceId, sourceId)))
    .limit(1);
  if (!existing) {
    // Extremely unlikely race (the conflicting row was deleted between
    // the insert attempt and this re-select) -- surface loudly rather
    // than silently losing the caller's result.
    throw new Error("discovery_results: conflict detected but the existing row could not be re-read");
  }
  return { result: existing, created: false };
}

/** Read-only lookup by (source, sourceId) — the same identity the unique
 * index enforces. Returns null when no such row exists. */
export async function findDiscoveryResultBySource(source: string, sourceId: string): Promise<DiscoveryResultRow | null> {
  const [row] = await db
    .select()
    .from(discoveryResults)
    .where(and(eq(discoveryResults.source, source), eq(discoveryResults.sourceId, sourceId)))
    .limit(1);
  return row ?? null;
}

// ---------------------------------------------------------------------
// MISSION C-2D-4-E — ENRICHMENT ENGINE — CLAIM / LEASE.
//
// A row's `enrichmentClaimedAt` (db/schema.ts) is non-null exactly while
// one enrichment attempt holds the exclusive right to write that row's
// enrichment fields. There is no separate lease TOKEN: the claimed
// timestamp ITSELF is the optimistic-concurrency version a later
// release/finalize call must present unchanged to prove it still owns the
// lease it thinks it owns — deliberately minimal, no extra column, no new
// migration beyond the two already added for this mission. A lease older
// than ENRICHMENT_LEASE_SECONDS is treated as abandoned (a crashed
// process, a killed serverless invocation, a network partition that never
// resolved) and becomes reclaimable by a fresh attempt — this is what
// satisfies "the lease must be able to expire so an abandoned attempt
// never blocks the fiche forever" without a background sweep/cron: the
// NEXT claim attempt does the reclaiming, lazily, exactly when needed.
// ---------------------------------------------------------------------

/** Comfortably longer than the transport's own request timeout
 * (google-places-http-transport.ts::DEFAULT_GOOGLE_PLACES_REQUEST_TIMEOUT_MS
 * = 8s) PLUS one bounded retry (errors.ts::MAX_DISCOVERY_RETRY_ATTEMPTS =
 * 1) plus the short finalize transaction itself — never so long that an
 * abandoned attempt blocks a fiche for an unreasonable time, never so
 * short that a genuinely in-flight (if slow) attempt gets reclaimed out
 * from under itself. */
export const ENRICHMENT_LEASE_SECONDS = 90;

export type ClaimDiscoveryResultForEnrichmentOutcome =
  | { status: "claimed"; row: DiscoveryResultRow }
  | { status: "not_found" }
  | { status: "ignored" }
  | { status: "already_enriched"; row: DiscoveryResultRow }
  | { status: "enrichment_in_progress" };

/**
 * Atomically claims a row for enrichment, or refuses with a precise
 * reason. The ACTUAL safety property (mutual exclusion between concurrent
 * claimants) is enforced entirely by the single UPDATE ... WHERE ...
 * RETURNING statement below — a single statement is already atomic in
 * Postgres, so no explicit transaction/lock is needed, and critically, NO
 * transaction is ever held open here waiting on anything (this function
 * returns before any network call is ever made). The preceding SELECT is
 * for producing a PRECISE rejection reason only (not_found / ignored /
 * already_enriched, distinguished from a genuine concurrent claim) — it
 * may be stale by the time the UPDATE runs, which is fine: the UPDATE's
 * own WHERE clause is what actually decides the outcome under a real race,
 * never the preceding SELECT's own (possibly stale) read.
 *
 * `ignored` is refused even with `forceRefresh: true` (mission section
 * 8's own explicit default) — forceRefresh exists to re-fetch data on an
 * establishment the caller still wants, never to resurrect one explicitly
 * dismissed.
 */
export async function claimDiscoveryResultForEnrichment(id: string, options: { forceRefresh: boolean }): Promise<ClaimDiscoveryResultForEnrichmentOutcome> {
  const [existing] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, id)).limit(1);
  if (!existing) return { status: "not_found" };
  if (existing.status === "ignored") return { status: "ignored" };
  if (existing.status === "enriched" && !options.forceRefresh) return { status: "already_enriched", row: existing };

  const now = new Date();
  const leaseExpiresBefore = new Date(now.getTime() - ENRICHMENT_LEASE_SECONDS * 1000);

  const conditions = [eq(discoveryResults.id, id), ne(discoveryResults.status, "ignored"), or(isNull(discoveryResults.enrichmentClaimedAt), lt(discoveryResults.enrichmentClaimedAt, leaseExpiresBefore))];
  if (!options.forceRefresh) {
    conditions.push(ne(discoveryResults.status, "enriched"));
  }

  const claimed = await db
    .update(discoveryResults)
    .set({ enrichmentClaimedAt: now })
    .where(and(...conditions))
    .returning();

  if (claimed.length === 0) {
    // Zero rows matched: either the state changed since our read above
    // (benign, expected under real concurrency) or a live lease is
    // already held by another attempt. Re-read once more to give the
    // caller the most precise reason available.
    const [current] = await db.select().from(discoveryResults).where(eq(discoveryResults.id, id)).limit(1);
    if (!current) return { status: "not_found" };
    if (current.status === "ignored") return { status: "ignored" };
    if (current.status === "enriched" && !options.forceRefresh) return { status: "already_enriched", row: current };
    return { status: "enrichment_in_progress" };
  }

  return { status: "claimed", row: claimed[0] };
}

/**
 * Releases a held lease WITHOUT waiting for it to expire — the failure-path
 * counterpart of a successful claim (mission section 7: "gestion des
 * erreurs... l'écriture échoue... l'audit échoue"). Optimistic: only
 * releases if `enrichmentClaimedAt` still exactly matches `claimedAt` —
 * guards against a very-late/duplicate release call ever clearing a NEWER
 * claim that has since been legitimately acquired by someone else after
 * this lease's own natural expiry. Never throws on "already released/
 * reclaimed" (0 rows affected is a normal, safe outcome, not an error).
 */
export async function releaseDiscoveryResultEnrichmentClaim(id: string, claimedAt: Date): Promise<void> {
  await db
    .update(discoveryResults)
    .set({ enrichmentClaimedAt: null })
    .where(and(eq(discoveryResults.id, id), eq(discoveryResults.enrichmentClaimedAt, claimedAt)));
}

export type FinalizeDiscoveryResultEnrichmentOutcome = { status: "enriched"; row: DiscoveryResultRow } | { status: "lease_lost" };

/**
 * The ONLY place enrichment fields are ever written. Called AFTER the
 * Google Details call has already completed — this function itself never
 * performs network I/O, so its transaction is short by construction
 * (mission section 6's own central requirement). Re-verifies the lease
 * INSIDE the transaction (SELECT ... FOR UPDATE, same locking discipline
 * radar-discovery-convert.ts already established) before writing anything
 * — `lease_lost` covers the case where the lease was somehow released/
 * reclaimed since the claim (extremely unlikely given the exclusive
 * claim above, but never assumed impossible).
 *
 * MERGE DISCIPLINE (mission sections 9/10): writes EXACTLY the four
 * enrichment columns from `patch` — never a spread of `row`, never any
 * other column. Because the Details field mask (adapters/google-places.ts)
 * is fixed and always requests exactly these four fields, every element
 * of `patch` is "confirmed" (a real value, or Google-confirmed `null`) —
 * there is no ambiguous "wasn't requested" case to represent here, so no
 * per-field "was this requested" tracking is needed.
 *
 * STATUS TRANSITION: "discovered" -> "enriched" on success. A row already
 * "converted" is LEFT AS "converted" (mission section 8's own explicit
 * requirement — enrichment continues on discovery_results after
 * conversion, but never propagates back to crm_clients, and never
 * overwrites the "converted" marker, which discovery_results_converted_link_check
 * structurally depends on staying paired with a non-null crmClientId).
 */
export async function finalizeDiscoveryResultEnrichment(id: string, claimedAt: Date, patch: DiscoveryDetailsResult, actorUserId: string): Promise<FinalizeDiscoveryResultEnrichmentOutcome> {
  return db.transaction(async (tx): Promise<FinalizeDiscoveryResultEnrichmentOutcome> => {
    const [row] = await tx.select().from(discoveryResults).where(eq(discoveryResults.id, id)).for("update").limit(1);

    if (!row || row.enrichmentClaimedAt === null || row.enrichmentClaimedAt.getTime() !== claimedAt.getTime()) {
      return { status: "lease_lost" };
    }

    const nextStatus = row.status === "converted" ? "converted" : "enriched";

    const [updated] = await tx
      .update(discoveryResults)
      .set({
        phone: patch.phone,
        website: patch.website,
        openingHours: patch.openingHours,
        businessStatus: patch.businessStatus,
        status: nextStatus,
        updatedAt: new Date(),
        enrichmentClaimedAt: null,
      })
      .where(eq(discoveryResults.id, id))
      .returning();

    // Same executor discipline as radar-discovery-convert.ts's own
    // logAudit() call — atomic with the UPDATE above: a rollback of
    // either rolls back the audit entry too (mission section 7's own
    // "que se passe-t-il si l'audit échoue" -- the whole enrichment is
    // rolled back with it, never a silently un-audited write).
    await logAudit(
      {
        actorUserId,
        action: "radar.discovery_result_enriched",
        targetType: "discovery_result",
        targetId: id,
        metadata: { source: row.source, sourceId: row.sourceId },
      },
      tx,
    );

    return { status: "enriched", row: updated };
  });
}
