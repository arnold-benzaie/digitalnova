"use server";

/**
 * RADAR INTELLIGENCE V1 — Slice 5 — the opt-in AI advisory server action.
 *
 * The ONLY thing the UI calls. It is:
 *  - server-authoritative: requireRadarAccess("RADAR_QUEUE_VIEW") is the
 *    FIRST statement (the exact capability the RADAR queue read already
 *    needs — OWNER / ADMIN / MANAGER / EMPLOYEE; no new permission).
 *  - opt-in only: runs solely on an explicit user click. Nothing calls it
 *    on page load, per prospect, or in the background.
 *  - provider-optional: with no configured/enabled provider it returns
 *    { status: "unavailable" } — never a RADAR error.
 *  - non-authoritative: the advisory is text; it changes no priority /
 *    score / qualification / assignee / queue order / follow-up, and
 *    triggers no CRM mutation, email, telephony, or n8n.
 *
 * The deterministic basis comes verbatim from the existing authoritative
 * engine (lib/actions/radar.ts::getProspectQualification -> lib/radar/
 * score.ts). Provider selection is the configured registry's job; the
 * result never names it. No api key / model / provider / workspace / staff
 * id is accepted from the caller or returned.
 *
 * RADAR INTELLIGENCE V2.1 — Phase D. `requestRadarIntelligenceAdvisory`
 * gained a second, OPTIONAL parameter: `requestedProviderId`, a
 * request-scoped provider PREFERENCE, never an identity/role/workspace
 * parameter. Backward compatible: every existing caller that passes only
 * `clientId` keeps the exact same behavior (Automatic routing, Anthropic
 * primary / OpenAI eligible fallback). The raw client value is NEVER
 * trusted directly — `isPolicyConfigurableProviderId()` narrows it to a
 * known, policy-configurable id or `null` BEFORE it ever reaches
 * produceRadarAdvisory()/resolveProviderPolicy(), so an unknown/forged
 * string can never become authorization and can never reach an adapter.
 * The resolver (provider-policy.ts) is the SOLE authority on whether the
 * requested provider is actually usable (OWNER policy + registration) —
 * this file never re-implements that check; it only prevents an
 * ill-typed value from reaching it.
 *
 * RADAR INTELLIGENCE V2.1 — Phase G4D (finalization). The per-user
 * advisory cooldown below is now backed by the SAME durable, atomic,
 * already-proven fixed-window rate limiter every other abuse-resistant
 * surface in this codebase uses (lib/api-v1/rate-limit.ts::checkRateLimit
 * — also reused, outside /api/v1, by lib/actions/crm-quote-access.ts,
 * crm-invoice-access.ts, crm-invoice-payment.ts, crm-quotes.ts, and
 * app/api/chat/route.ts) instead of an in-memory `Map`. See this file's
 * own G4D audit: the cooldown and the OWNER-configured durable AI quota
 * gate (advisory-core.ts::evaluateAiQuotaGate, G4B-2) are COMPLEMENTARY,
 * never redundant — the quota gate is a GLOBAL, OWNER-opt-in daily budget
 * (quota-counter-store.ts: "G4B's quota is workspace-wide, never
 * per-user"; its documented DEFAULT is `enabled: true, dailyRequestLimit:
 * null` — i.e. UNLIMITED until an OWNER deliberately configures a cap),
 * while the cooldown is a PER-USER, always-on floor against a single
 * scripted/rapid-click caller that has nothing to do with whether any
 * OWNER limit is configured. Removing the cooldown on the theory that the
 * durable quota already "proves" equivalent protection would be
 * incorrect in the DEFAULT (unlimited) policy state — the two invariants
 * are computed independently, and the cooldown is the only thing standing
 * between one user's rapid clicking and unbounded real provider dispatch
 * when no OWNER cap is configured. What DID need fixing was the
 * IMPLEMENTATION: an in-memory `Map` is per-server-instance and does not
 * durably survive a serverless cold start / horizontal scale-out, so its
 * real-world protection was weaker than intended. Reusing checkRateLimit()
 * keeps the exact same 8-second, one-request-per-user contract, but now
 * durable and cross-instance, via the already-atomic, already-concurrency-
 * proven `INSERT ... ON CONFLICT DO UPDATE ... RETURNING` technique (same
 * SQL shape independently proven under real concurrency by
 * lib/radar-intelligence/quota-counter-store.concurrency.integration.test.mjs)
 * — zero new table, zero migration.
 */
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, interactions, tasks } from "@/db/schema";
import { evaluateStaffPermission, requireRadarAccess } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { getProspectQualification } from "@/lib/actions/radar";
import { checkRateLimit } from "@/lib/api-v1/rate-limit";
import { createConfiguredRadarIntelligenceRegistry } from "@/lib/radar-intelligence/configured-registry";
import { produceRadarAdvisory, type AdvisoryDisplayContext, type RadarAdvisoryUiResult } from "@/lib/radar-intelligence/advisory-core";
import { logRadarIntelligenceEvent } from "@/lib/radar-intelligence/observability";
import { isPolicyConfigurableProviderId, type PolicyConfigurableProviderId } from "@/lib/radar-intelligence/provider-policy";
import { loadProviderPolicy } from "@/lib/radar-intelligence/provider-policy-store";
import { loadProviderModelOverrides } from "@/lib/radar-intelligence/provider-runtime-config-store";

/**
 * Strips every SYSTEM_ADMIN-only field from `result`, returning ONLY the
 * fields every caller may see. An explicit ALLOWLIST copy, not a
 * denylist-omit: a future admin-only field added to the "ok" shape is
 * dropped by default here unless someone deliberately adds it below —
 * the same fail-closed convention as sanitizeProspectContext()'s
 * allowlist-only construction and logRadarIntelligenceEvent()'s
 * allowlisted fields.
 */
function stripAdminOnlyFields(result: RadarAdvisoryUiResult): RadarAdvisoryUiResult {
  // RADAR INTELLIGENCE V2.1 — Phase G4B-2: `deterministic` on a
  // `"limited"` result is NOT an admin-only field (it is the exact same
  // authoritative RADAR CORE block every "ok" result already carries,
  // never provider/model identity) — it must pass through to EVERY
  // caller, not just SYSTEM_ADMIN, so a quota block never hides the
  // deterministic basis from an ordinary staff member.
  if (result.status === "limited") {
    return { status: "limited", deterministic: result.deterministic };
  }
  if (result.status !== "ok") {
    return { status: result.status };
  }
  return {
    status: "ok",
    summary: result.summary,
    suggestedNextAction: result.suggestedNextAction,
    risks: result.risks,
    reasoning: result.reasoning,
    generatedAt: result.generatedAt,
    deterministic: result.deterministic,
    // providerMeta intentionally omitted — SYSTEM_ADMIN-only.
  };
}

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4D. Small anti-spam floor: one advisory
 * per user per 8-second fixed window, durable (checkRateLimit(), see this
 * file's own header comment for why this is complementary to — never a
 * duplicate of — the OWNER-configured durable AI quota gate). The UI
 * button lock is the primary guard; this backstops a scripted/rapid
 * caller regardless of whether the button lock was bypassed.
 *
 * `scope` is a dedicated, collision-free namespace within the shared
 * `integration_api_rate_limit_hits` table — other reusers of
 * checkRateLimit() (api-v1 routes, crm-quote-access.ts, etc.) each use
 * their own distinct scope string; there is no cross-feature interaction.
 */
const ADVISORY_COOLDOWN_SCOPE = "radar_advisory";
const ADVISORY_COOLDOWN_REQUESTS_PER_WINDOW = 1;
const ADVISORY_COOLDOWN_WINDOW_SECONDS = 8;

const OPEN_TASK_STATUSES = ["todo", "in_progress"] as const;
const RECENT_SUMMARY_LIMIT = 3;

function locationLabel(row: { city: string | null; region: string | null; country: string | null }): string | null {
  const parts = [row.city, row.region, row.country].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

async function loadDisplayContext(clientId: string): Promise<AdvisoryDisplayContext | null> {
  const [client] = await db
    .select({
      name: crmClients.name,
      industry: crmClients.industry,
      city: crmClients.city,
      region: crmClients.region,
      country: crmClients.country,
      stage: crmClients.stage,
    })
    .from(crmClients)
    .where(eq(crmClients.id, clientId))
    .limit(1);
  if (!client) return null;

  const recent = await db
    .select({ summary: interactions.summary })
    .from(interactions)
    .where(eq(interactions.clientId, clientId))
    .orderBy(desc(interactions.occurredAt))
    .limit(RECENT_SUMMARY_LIMIT);

  const [openFollowUps] = await db
    .select({ value: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.clientId, clientId), isNotNull(tasks.dueDate), inArray(tasks.status, OPEN_TASK_STATUSES)));

  return {
    name: client.name,
    sector: client.industry,
    location: locationLabel(client),
    stage: client.stage,
    recentInteractionSummaries: recent.map((r) => r.summary),
    openFollowUpCount: Number(openFollowUps?.value ?? 0),
  };
}

export async function requestRadarIntelligenceAdvisory(
  clientId: string,
  requestedProviderId?: string | null,
): Promise<RadarAdvisoryUiResult> {
  // Authorization stays OUTSIDE the try/catch below: requireStaffMember()
  // signals a denial by THROWING a Next.js redirect, and that throw must
  // propagate untouched for the redirect to happen. Nothing past this
  // point ever swallows it. Unchanged by Phase D: provider CHOICE is
  // constrained by OWNER policy inside the resolver, never by a new/
  // different permission here — every role that could request an
  // advisory before Phase D still can, identically.
  await requireRadarAccess("RADAR_QUEUE_VIEW");
  const { userId } = await requireSession();

  // RADAR INTELLIGENCE V2.1 Phase D — narrow the raw client value to a
  // known, policy-configurable provider id or `null`. This is NOT the
  // authorization check (that lives entirely in resolveProviderPolicy(),
  // via the OWNER policy loaded fresh inside produceRadarAdvisory on
  // every call) — it only guarantees an arbitrary/forged string can never
  // reach that far as anything other than `null`.
  const validatedProviderId: PolicyConfigurableProviderId | null = isPolicyConfigurableProviderId(requestedProviderId)
    ? requestedProviderId
    : null;

  try {
    // RADAR INTELLIGENCE V2.1 — Phase G4D. Durable per-user cooldown — see
    // this file's own header comment for the full complementary-vs-quota
    // rationale. Deliberately FAILS OPEN (logs, does not block) if the
    // rate-limit store itself errors: this check is a lightweight,
    // non-authoritative anti-spam floor on an opt-in, non-authoritative
    // advisory feature, never RADAR CORE's own authority — a transient
    // outage of this ONE table must never take the advisory button down
    // for every user. This is intentionally the OPPOSITE fail-direction
    // from the OWNER-configured AI quota gate (advisory-core.ts::
    // evaluateAiQuotaGate), which stays strictly fail-closed because it is
    // the actual binding cost/abuse boundary; even a fail-open cooldown
    // still cannot cause unbounded spend, because every request — cooldown
    // outage or not — still passes through that unchanged, fail-closed
    // gate immediately afterward.
    try {
      const cooldown = await checkRateLimit(ADVISORY_COOLDOWN_SCOPE, userId, ADVISORY_COOLDOWN_REQUESTS_PER_WINDOW, ADVISORY_COOLDOWN_WINDOW_SECONDS);
      if (!cooldown.allowed) {
        return { status: "rate_limited" };
      }
    } catch {
      logRadarIntelligenceEvent({ source: "advisory_cooldown", code: "COOLDOWN_STORE_UNAVAILABLE" });
    }

    // The app's CURRENT interface locale — resolved server-side, the same
    // way every page already does (lib/i18n/locale.ts::getLocale()).
    // Never inferred from prospect data, never accepted from the caller.
    const locale = await getLocale();

    // RADAR INTELLIGENCE V2.1 Phase E — load any OWNER-configured model
    // override ONCE, async, here — never inside the synchronous
    // `createRegistry` closure below. `loadProviderModelOverrides()` is
    // itself fail-closed (DB failure / unknown stored model -> {}), and
    // `createConfiguredRadarIntelligenceRegistry` re-validates every
    // entry again against the model catalog, so a stale or corrupt
    // override can only ever fall back to the env-configured model —
    // never reach a transport unvalidated.
    const modelOverrides = await loadProviderModelOverrides();

    const result = await produceRadarAdvisory(
      clientId,
      {
        loadQualification: getProspectQualification,
        loadDisplayContext,
        createRegistry: () => createConfiguredRadarIntelligenceRegistry({ modelOverrides }),
        locale,
        // RADAR INTELLIGENCE V2.1 Phase G2 — the session identity already
        // resolved above, stamped ONLY onto best-effort operational
        // telemetry (never used for authorization, never forwarded to a
        // provider).
        actorUserId: userId,
      },
      validatedProviderId,
    );

    // Two DISTINCT SYSTEM_ADMIN-only affordances share one re-check:
    //  - the coarse failure class (+ exact provider HTTP status), present
    //    only on a genuine provider failure;
    //  - providerMeta (provider id + model), present only on a genuine
    //    successful advisory.
    // Either goes out ONLY to a caller who holds SYSTEM_ADMIN (OWNER /
    // ADMIN today — the same permission that gates the provider-status
    // service). Every other caller gets the exact safe result via
    // stripAdminOnlyFields() below, which is a FRESH object built from an
    // explicit allowlist, so it structurally cannot carry any of these
    // fields even if a future field is added and this check forgets it.
    // The check uses the session identity resolved above, never a
    // client-supplied argument. permissions.ts is unchanged.
    const hasAdminOnlyField = ("diagnostic" in result && result.diagnostic !== undefined) || (result.status === "ok" && result.providerMeta !== undefined);
    if (hasAdminOnlyField) {
      let admin;
      try {
        admin = await evaluateStaffPermission({ userId, permission: "SYSTEM_ADMIN" });
      } catch {
        // The re-check itself failed (e.g. a transient DB hiccup on the
        // SECOND permission lookup, after the FIRST one above already
        // succeeded for this same request). Fail closed on exposure —
        // never expose the admin-only fields — but do NOT let this throw
        // take down the whole advisory: the caller still gets the safe
        // result they would have gotten anyway.
        logRadarIntelligenceEvent({ source: "diagnostic_permission_check", code: "SYSTEM_ADMIN_CHECK_FAILED", status: result.status });
        return stripAdminOnlyFields(result);
      }
      if (!admin.ok) {
        return stripAdminOnlyFields(result);
      }
    }

    return result;
  } catch {
    // Any other unexpected failure in the business logic above (never an
    // auth redirect — that already propagated before this try started).
    // Convert it to the exact same safe result the client's own catch
    // would have produced, but make it server-observable first.
    logRadarIntelligenceEvent({ source: "server_action_boundary", code: "SERVER_ACTION_UNHANDLED_ERROR", status: "error" });
    return { status: "error" };
  }
}

/**
 * RADAR INTELLIGENCE V2.1 — Phase D. Read-only, safe echo of WHICH
 * providers the current OWNER policy currently authorizes a user to
 * explicitly request — used ONLY to decide whether to render the
 * selector at all, and with which options. Gated by the SAME
 * "RADAR_QUEUE_VIEW" permission as the advisory request itself — no new
 * role requirement merely to see the selector (mission requirement:
 * provider-choice availability depends on OWNER policy, not role
 * escalation).
 *
 * This is NEVER the authorization path: requestRadarIntelligenceAdvisory
 * always re-derives the OWNER policy fresh, independently, on every
 * single request via resolveProviderPolicy() — a stale/cached result
 * from this function can at most make the selector show (or hide) a
 * choice the actual request will still correctly accept or reject on its
 * own. `selectableProviders` is already intersected with the technically
 * REGISTERED providers (mirrors provider-status.ts's registration-vs-
 * policy distinction), so the UI never advertises a choice that is
 * policy-selectable but not currently configured. An empty array means
 * "hide the selector" — covers both "OWNER disabled selection" and
 * "nothing is currently usable" uniformly, so the UI needs no separate
 * `allowUserSelection` flag.
 */
export async function getRadarAiProviderSelectionOptions(): Promise<{ selectableProviders: PolicyConfigurableProviderId[] }> {
  await requireRadarAccess("RADAR_QUEUE_VIEW");

  const ownerPolicy = await loadProviderPolicy();
  if (!ownerPolicy.allowUserSelection) {
    return { selectableProviders: [] };
  }

  const registry = createConfiguredRadarIntelligenceRegistry();
  const registeredIds = new Set(registry.list().map((adapter) => adapter.id));
  const selectableProviders = ownerPolicy.userSelectableProviders.filter(
    (id): id is PolicyConfigurableProviderId => isPolicyConfigurableProviderId(id) && registeredIds.has(id),
  );

  return { selectableProviders };
}
