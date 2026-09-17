"use server";

/**
 * RADAR DISCOVERY ENGINE — MISSION C-2D-4-E — the ONE server action for
 * the Enrichment Engine. Deliberately a SEPARATE file from
 * radar-discovery-search.ts: Search (mass discovery, field-mask locked to
 * "minimal_discovery" server-side since C-2D-4-C) and Enrichment (a single,
 * individually-triggered Details lookup) must never share a code path,
 * a field-mask mechanism, a rate-limit scope, or a permission.
 *
 * PIPELINE (mission section 2/6):
 *   discovery_results row (already exists)
 *     -> Enrichment Request { discoveryResultId }   [this file's own input]
 *     -> Authorization                              [requireRadarAccess("RADAR_DISCOVERY_ENRICH")]
 *     -> Rate/Quota Gate                             [checkDiscoveryEnrichmentActorRateLimit — ENRICHMENT'S OWN scope]
 *     -> claim (short, atomic UPDATE, no open transaction)
 *     -> Provider Details (Google Places, via the generic DiscoveryProvider
 *        interface — this file never imports anything Google-specific)
 *     -> finalize (short transaction: re-verify lease, merge, audit, release)
 *     -> enriched
 *
 * DB LOCK SAFETY (mission section 6 — a MANDATORY correction of the prior
 * C-2D-4-D design sketch): NO Postgres transaction is ever held open
 * across the `provider.getDetails()` network call below. The claim and
 * the finalize are each their own short-lived DB operation
 * (discovery-result-store.ts's own claim/lease section explains why a
 * single atomic UPDATE needs no explicit transaction, and why the
 * finalize transaction never performs I/O of its own). Between them, this
 * function holds ZERO database connection while awaiting Google.
 *
 * CONCURRENCY (mission section 7): two simultaneous requests for the same
 * discoveryResultId can never both call Google — the claim is exclusive
 * (discovery-result-store.ts's own atomic UPDATE ... WHERE ... RETURNING).
 * The loser observes "enrichment_in_progress" and never touches the
 * provider at all.
 *
 * NEVER accepts a fieldSet from the caller (mission section 4/13) — this
 * action's signature has no such parameter, structurally. NEVER calls
 * requireCrmClientAccess() or touches crm_clients (mission sections
 * 10/14/19) — enrichment is exclusively a discovery_results write. NEVER
 * propagates automatically to a converted crm_client (mission section 8/19).
 */
import { requireRadarAccess } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { isValidUuid } from "@/lib/api-v1/dto";
import { checkDiscoveryEnrichmentActorRateLimit } from "@/lib/radar-discovery/actor-rate-limit";
import { createConfiguredGooglePlacesProvider } from "@/lib/radar-discovery/adapters/configured-google-places";
import { claimDiscoveryResultForEnrichment, finalizeDiscoveryResultEnrichment, releaseDiscoveryResultEnrichmentClaim } from "@/lib/radar-discovery/discovery-result-store";
import { logDiscoveryProviderEvent } from "@/lib/radar-discovery/observability";
import type { DiscoveryError } from "@/lib/radar-discovery/errors";

/** The four enrichment-tier fields, verbatim from the persisted row —
 * never a raw provider payload, never anything beyond these four columns
 * (mirrors discovery-result-store.ts's own merge discipline). Surfaced on
 * BOTH "enriched" and "already_enriched" so the UI can render the actual
 * data immediately, without a second round trip. */
export type DiscoveryEnrichmentData = {
  phone: string | null;
  website: string | null;
  openingHours: unknown;
  businessStatus: string | null;
};

export type EnrichDiscoveryResultOutcome =
  | ({ status: "enriched"; discoveryResultId: string } & DiscoveryEnrichmentData)
  | ({ status: "already_enriched"; discoveryResultId: string } & DiscoveryEnrichmentData)
  | { status: "not_found" }
  | { status: "ignored" }
  | { status: "enrichment_in_progress" }
  | { status: "actor_rate_limited"; retryAfterSeconds: number }
  | { status: "provider_unavailable" }
  | { status: "provider_rate_limited" }
  | { status: "provider_timeout" }
  | { status: "provider_error" };

function mapDiscoveryErrorToEnrichOutcome(error: DiscoveryError): EnrichDiscoveryResultOutcome {
  switch (error.code) {
    case "PROVIDER_RATE_LIMITED":
    case "QUOTA_EXCEEDED":
      return { status: "provider_rate_limited" };
    case "PROVIDER_TIMEOUT":
      return { status: "provider_timeout" };
    case "PROVIDER_UNAVAILABLE":
    case "NO_CAPABLE_PROVIDER":
      return { status: "provider_unavailable" };
    default:
      return { status: "provider_error" };
  }
}

/**
 * The single entry point. `rawDiscoveryResultId` is `unknown` on purpose —
 * never trusted to already be a valid uuid merely because it type-checks
 * at the call site (mirrors convertDiscoveryResult()'s own discipline).
 * `forceRefresh` defaults to `false`: re-fetching an already-`enriched`
 * row never happens implicitly.
 */
export async function enrichDiscoveryResult(rawDiscoveryResultId: unknown, options?: { forceRefresh?: boolean }): Promise<EnrichDiscoveryResultOutcome> {
  // Authorization OUTSIDE any try/catch — requireRadarAccess() signals a
  // denial by THROWING a Next.js redirect, which must propagate untouched
  // (same convention as every other RADAR-gated action in this codebase).
  // A NEW, dedicated permission — never RADAR_QUEUE_VIEW/RADAR_WORK
  // reused, and never a bypass of requireRadarAccess() itself (mission
  // section 13).
  await requireRadarAccess("RADAR_DISCOVERY_ENRICH");
  // The acting identity — ALWAYS the resolved session, NEVER accepted
  // from the caller's input.
  const { userId } = await requireSession();

  if (typeof rawDiscoveryResultId !== "string" || !isValidUuid(rawDiscoveryResultId)) {
    // Deliberately indistinguishable from a genuinely nonexistent row
    // below — mirrors convertDiscoveryResult()'s own "not_found" opacity,
    // so a forged id can never be used to probe existence.
    return { status: "not_found" };
  }
  const discoveryResultId = rawDiscoveryResultId;
  const forceRefresh = options?.forceRefresh === true;

  // Enrichment's OWN actor rate-limit scope — completely independent of
  // Search's (checkDiscoveryActorRateLimit) — before any DB write or
  // provider call (mission section 11's exact ordering, mirroring C-2A's
  // own "validation -> actor rate-limit -> provider").
  const actorRateLimit = await checkDiscoveryEnrichmentActorRateLimit(userId);
  if (!actorRateLimit.allowed) {
    return { status: "actor_rate_limited", retryAfterSeconds: actorRateLimit.retryAfterSeconds };
  }

  // SHORT, ATOMIC claim — see discovery-result-store.ts's own header for
  // why this needs no explicit transaction and never blocks on I/O.
  const claim = await claimDiscoveryResultForEnrichment(discoveryResultId, { forceRefresh });
  if (claim.status === "not_found") return { status: "not_found" };
  if (claim.status === "ignored") return { status: "ignored" };
  if (claim.status === "already_enriched") {
    return {
      status: "already_enriched",
      discoveryResultId,
      phone: claim.row.phone,
      website: claim.row.website,
      openingHours: claim.row.openingHours,
      businessStatus: claim.row.businessStatus,
    };
  }
  if (claim.status === "enrichment_in_progress") return { status: "enrichment_in_progress" };

  const claimedRow = claim.row;
  // Non-null by construction: claimDiscoveryResultForEnrichment() only
  // ever returns "claimed" after setting this column to `now()`.
  const claimedAt = claimedRow.enrichmentClaimedAt as Date;

  const provider = createConfiguredGooglePlacesProvider();
  if (!provider || !provider.getDetails) {
    // Not configured, or (structurally impossible today, but never
    // assumed) a provider without the "get_details" capability — release
    // immediately rather than leaving the row claimed until the lease
    // naturally expires.
    await releaseDiscoveryResultEnrichmentClaim(discoveryResultId, claimedAt);
    return { status: "provider_unavailable" };
  }

  // THE network call — deliberately the ONLY thing between the claim
  // above and the release/finalize below. No database connection is held
  // by this function while this line is in flight (mission section 6).
  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await provider.getDetails(claimedRow.sourceId, "details");
  } catch (thrown) {
    await releaseDiscoveryResultEnrichmentClaim(discoveryResultId, claimedAt);
    const error = thrown as DiscoveryError;
    logDiscoveryProviderEvent({
      providerId: provider.id,
      outcome: "failure",
      ...(typeof error?.code === "string" ? { errorCode: error.code } : {}),
      latencyMs: Date.now() - startedAt,
      attemptCount: 1,
    });
    return mapDiscoveryErrorToEnrichOutcome(error);
  }

  // SHORT finalize transaction — re-verifies the lease, merges, audits,
  // releases. Never performs network I/O of its own (mission section 6).
  const finalized = await finalizeDiscoveryResultEnrichment(discoveryResultId, claimedAt, outcome.result, userId);
  if (finalized.status === "lease_lost") {
    // Extremely unlikely given the exclusive claim above (would require
    // the lease to have been externally cleared AND reclaimed within this
    // single request's own lifetime) — fail safe rather than silently
    // report success for a write that did not actually happen.
    return { status: "provider_error" };
  }

  logDiscoveryProviderEvent({
    providerId: provider.id,
    outcome: "success",
    latencyMs: Date.now() - startedAt,
    resultCount: 1,
    attemptCount: 1,
  });
  return {
    status: "enriched",
    discoveryResultId,
    phone: finalized.row.phone,
    website: finalized.row.website,
    openingHours: finalized.row.openingHours,
    businessStatus: finalized.row.businessStatus,
  };
}
