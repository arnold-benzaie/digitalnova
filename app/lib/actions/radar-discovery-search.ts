"use server";

/**
 * RADAR DISCOVERY ENGINE — Phase C-2A — the ONE orchestrating server
 * action wiring every already-existing Discovery/CRM primitive together.
 * This file adds NO new business logic of its own beyond sequencing —
 * every real decision (validation, rate limiting, network, matching,
 * persistence) is delegated to the module that already owns it:
 *
 *   requireRadarAccess("RADAR_QUEUE_VIEW")        [existing RBAC gate]
 *   validateDiscoverySearchRequest()              [C-0]
 *   checkDiscoveryActorRateLimit()                [C-2A, new — per actor]
 *   createConfiguredGooglePlacesProvider()        [C-1]
 *   provider.search()                             [C-1 — owns its own
 *                                                   provider-level rate
 *                                                   limit, retry, timeout,
 *                                                   circuit breaker]
 *   findCrmClientMatch()                          [Phase A]
 *   createDiscoveryResult()                       [Phase B]
 *   logDiscoveryProviderEvent()                   [C-1]
 *
 * Order (mission section 6): authentication -> authorization ->
 * validation -> actor rate-limit -> provider. An invalid request never
 * reaches Google and never spends an actor rate-limit unit; a rate-limit
 * denial never reaches Google.
 *
 * NEVER creates a crm_client, assignment, task, interaction, email, or
 * phone call. NEVER lets the caller set discovery_results.status or
 * .crmClientId (createDiscoveryResult()'s own input type has no such
 * fields at all — structurally impossible, not just a convention here).
 *
 * CRM-VISIBILITY SAFETY (mission section 10): findCrmClientMatch() is
 * used, NEVER requireCrmClientAccess() — the former is deliberately
 * GLOBAL (matches against every crm_clients row regardless of
 * assigned_user_id), which is exactly the property needed to detect a
 * duplicate an EMPLOYEE cannot see in the UI. An EXACT_MATCH never
 * surfaces the matched client's id, name, or any other CRM-internal
 * field to the caller — only the generic "already_in_crm" status,
 * alongside the SAME provider-supplied name/source/sourceId the caller
 * already has (that data came from Google, not from the hidden CRM row).
 * An AMBIGUOUS_MATCH is deliberately NOT surfaced at all (surfacing
 * candidateClientIds would itself be a CRM-visibility leak) — it is
 * treated as "not yet a confirmed duplicate" and the discovery result is
 * still created normally, exactly matching Phase A's own "never merge on
 * an ambiguous signal" philosophy.
 */
import { requireRadarAccess } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { validateDiscoverySearchRequest } from "@/lib/radar-discovery/search-request";
import { checkDiscoveryActorRateLimit } from "@/lib/radar-discovery/actor-rate-limit";
import { createConfiguredGooglePlacesProvider } from "@/lib/radar-discovery/adapters/configured-google-places";
import { findCrmClientMatch } from "@/lib/crm-client-dedup";
import { createDiscoveryResult } from "@/lib/radar-discovery/discovery-result-store";
import { logDiscoveryProviderEvent } from "@/lib/radar-discovery/observability";
import type { DiscoveryError } from "@/lib/radar-discovery/errors";
import type { DiscoveryProviderResult } from "@/lib/radar-discovery/types";

export type RadarDiscoverySearchItem =
  | { status: "created"; source: string; sourceId: string; name: string; discoveryResultId: string }
  | { status: "already_discovered"; source: string; sourceId: string; name: string; discoveryResultId: string }
  /** Deliberately carries NOTHING beyond what the caller already has from
   * Google (source/sourceId/name) — never a crm_clients id, never any
   * other CRM-internal field. See this file's own header. */
  | { status: "already_in_crm"; source: string; sourceId: string; name: string };

export type RadarDiscoverySearchResult =
  | {
      status: "ok";
      items: RadarDiscoverySearchItem[];
      createdCount: number;
      alreadyDiscoveredCount: number;
      alreadyInCrmCount: number;
      /** Opaque, relayed verbatim from the provider (C-0's own pagination
       * abstraction) — this action never inspects or constructs it. */
      nextCursor: string | null;
    }
  | { status: "invalid_request"; reason: string }
  | { status: "actor_rate_limited"; retryAfterSeconds: number }
  | { status: "provider_unavailable" }
  | { status: "provider_rate_limited" }
  | { status: "provider_timeout" }
  | { status: "provider_error" };

function mapDiscoveryErrorToActionResult(error: DiscoveryError): RadarDiscoverySearchResult {
  switch (error.code) {
    case "PROVIDER_RATE_LIMITED":
    case "QUOTA_EXCEEDED":
      return { status: "provider_rate_limited" };
    case "PROVIDER_TIMEOUT":
      return { status: "provider_timeout" };
    case "PROVIDER_UNAVAILABLE":
    case "NO_CAPABLE_PROVIDER":
      return { status: "provider_unavailable" };
    case "INVALID_SEARCH_REQUEST":
      // Should not occur here (already validated before provider.search()
      // is ever called) — fail safe rather than assume.
      return { status: "invalid_request", reason: "the provider rejected the search request" };
    default:
      return { status: "provider_error" };
  }
}

/**
 * The single entry point. `rawRequest` is `unknown` on purpose — never
 * trusted to already match DiscoverySearchRequest's shape merely because
 * it type-checks at the call site.
 */
export async function searchRadarDiscovery(rawRequest: unknown): Promise<RadarDiscoverySearchResult> {
  // Authorization is OUTSIDE the try/catch below: requireRadarAccess()
  // signals a denial by THROWING a Next.js redirect, and that throw must
  // propagate untouched — the exact same convention every other
  // RADAR-gated action in this codebase already follows (radar.ts,
  // radar-queue.ts, radar-assignment.ts, radar-intelligence.ts). OWNER/
  // ADMIN/MANAGER/EMPLOYEE-with-radar_access=true pass; CLIENT and any
  // EMPLOYEE with radar_access=false are redirected before this line
  // returns. No new permission — RADAR_QUEUE_VIEW is the exact same
  // capability the RADAR queue read already requires.
  await requireRadarAccess("RADAR_QUEUE_VIEW");
  // The acting identity — ALWAYS the resolved session, NEVER accepted
  // from `rawRequest` (which has no userId field in its validated shape
  // at all — see search-request.ts).
  const { userId } = await requireSession();

  const validated = validateDiscoverySearchRequest(rawRequest);
  if (!validated.ok) {
    return { status: "invalid_request", reason: validated.reason };
  }

  // Actor rate-limit BEFORE any provider call — mission section 6's
  // exact ordering. An invalid request above never reached this line, so
  // it never spent an actor-level unit either.
  const actorRateLimit = await checkDiscoveryActorRateLimit(userId);
  if (!actorRateLimit.allowed) {
    return { status: "actor_rate_limited", retryAfterSeconds: actorRateLimit.retryAfterSeconds };
  }

  const provider = createConfiguredGooglePlacesProvider();
  if (!provider) {
    // Not configured (flag off, or no credential) -- never a silent
    // fallback to a mock, never an attempted call.
    return { status: "provider_unavailable" };
  }

  const startedAt = Date.now();
  let outcome;
  try {
    outcome = await provider.search(validated.request);
  } catch (thrown) {
    const error = thrown as DiscoveryError;
    logDiscoveryProviderEvent({
      providerId: provider.id,
      outcome: "failure",
      ...(typeof error?.code === "string" ? { errorCode: error.code } : {}),
      latencyMs: Date.now() - startedAt,
      attemptCount: 1,
    });
    return mapDiscoveryErrorToActionResult(error);
  }

  const items: RadarDiscoverySearchItem[] = [];
  let createdCount = 0;
  let alreadyDiscoveredCount = 0;
  let alreadyInCrmCount = 0;

  for (const result of outcome.results) {
    const item = await processDiscoveryResult(result);
    items.push(item);
    if (item.status === "created") createdCount += 1;
    else if (item.status === "already_discovered") alreadyDiscoveredCount += 1;
    else alreadyInCrmCount += 1;
  }

  logDiscoveryProviderEvent({
    providerId: provider.id,
    outcome: "success",
    latencyMs: Date.now() - startedAt,
    resultCount: outcome.results.length,
    attemptCount: 1,
  });

  return {
    status: "ok",
    items,
    createdCount,
    alreadyDiscoveredCount,
    alreadyInCrmCount,
    nextCursor: outcome.nextCursor,
  };
}

/**
 * Per-result pipeline: CRM dedup FIRST (mission's own diagram order —
 * "normalization -> dedup -> discovery_results store"), then persistence
 * only when no confirmed CRM duplicate exists.
 */
async function processDiscoveryResult(result: DiscoveryProviderResult): Promise<RadarDiscoverySearchItem> {
  const crmMatch = await findCrmClientMatch({
    name: result.name,
    email: result.email,
    phone: result.phone,
    city: result.city,
    region: result.region,
    country: result.country,
  });

  if (crmMatch.outcome === "EXACT_MATCH") {
    return { status: "already_in_crm", source: result.source, sourceId: result.sourceId, name: result.name };
  }

  // NO_MATCH or AMBIGUOUS_MATCH: still a legitimate discovery result --
  // an ambiguous signal is never treated as confirmed, and never leaked
  // (see this file's own header).
  const { result: row, created } = await createDiscoveryResult({
    source: result.source,
    sourceId: result.sourceId,
    sourceUrl: result.sourceUrl,
    name: result.name,
    category: result.category,
    address: result.address,
    country: result.country,
    region: result.region,
    city: result.city,
    postalCode: result.postalCode,
    phone: result.phone,
    email: result.email,
    website: result.website,
    latitude: result.latitude,
    longitude: result.longitude,
    // GOOGLE PLACES CORRECTION field, verified real (C-0), persisted
    // verbatim -- never computed, never a local time (mission section 13).
    timezone: result.timezone,
    openingHours: result.openingHours,
  });

  return {
    status: created ? "created" : "already_discovered",
    source: row.source,
    sourceId: row.sourceId,
    name: row.name,
    discoveryResultId: row.id,
  };
}
