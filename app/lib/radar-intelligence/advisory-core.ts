import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 5 — testable core of the opt-in AI
 * advisory. SERVER-ONLY, but NOT a `"use server"` action — so it accepts
 * an injectable deps bag (the action wires the real implementations; tests
 * wire fakes with no DB and no network).
 *
 * It performs exactly ONE gateway request (maxRetries = 0), never throws a
 * provider error to the caller, takes the deterministic RADAR basis
 * verbatim from the injected authoritative loader, and returns a safe
 * UI-shaped result that never carries a provider name, api key, model,
 * request id, usage, or a raw error.
 */
import type { ProspectQualificationResult } from "@/lib/actions/radar";
import { isValidUuid } from "@/lib/api-v1/dto";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { ProviderFailureClass } from "./errors";
import { createProviderRouter } from "./provider-router";
import { resolveProviderPolicy, type ProviderPolicy } from "./provider-policy";
import { loadProviderPolicy as loadProviderPolicyFromStore } from "./provider-policy-store";
import { logRadarIntelligenceEvent } from "./observability";
import { sanitizeProspectContext } from "./sanitize-context";
import type { ProviderRegistry } from "./provider-registry";
import type { IntelligenceProviderId } from "./types";

export type RadarAdvisoryUiResult =
  | {
      status: "ok";
      /** AI-generated advisory text — display only. */
      summary: string;
      suggestedNextAction: string | null;
      /** Short risk phrases — advisory only, never a deterministic score. */
      risks: string[];
      /** A short grounding explanation — advisory only. */
      reasoning: string | null;
      generatedAt: string;
      /** The AUTHORITATIVE deterministic values, shown in a separate block. */
      deterministic: { priority: string; confidence: string; recommendedNextAction: string };
      /**
       * Non-secret provider/model identity. Always computed here when
       * available — the SYSTEM_ADMIN-only exposure boundary is enforced
       * by the server action (lib/actions/radar-intelligence.ts), which
       * strips this field for every non-SYSTEM_ADMIN caller, exactly like
       * `diagnostic`/`httpStatus` below. Never an api key, header, or
       * anything else about the request/response.
       */
      providerMeta?: { provider: string; model: string; fallbackUsed: boolean };
    }
  | { status: "unavailable"; diagnostic?: ProviderFailureClass; httpStatus?: number }
  | { status: "rate_limited"; diagnostic?: ProviderFailureClass; httpStatus?: number }
  | { status: "timeout"; diagnostic?: ProviderFailureClass; httpStatus?: number }
  | { status: "error"; diagnostic?: ProviderFailureClass; httpStatus?: number }
  /** The prospect is not QUALIFIED — no deterministic basis to advise on. */
  | { status: "not_applicable" };

export type AdvisoryDisplayContext = {
  name: string;
  sector: string | null;
  location: string | null;
  stage: string;
  recentInteractionSummaries: string[];
  openFollowUpCount: number;
};

type AdvisoryFailureStatus = "unavailable" | "rate_limited" | "timeout" | "error";

/**
 * Builds one failure variant of RadarAdvisoryUiResult. `diagnostic` and
 * `httpStatus` are added ONLY together with each other and ONLY when a
 * `diagnostic` (failureClass) actually exists — httpStatus is never
 * exposed on its own, mirroring the exact same SYSTEM_ADMIN-only
 * exposure boundary the action applies afterward.
 */
function buildFailureResult(
  status: AdvisoryFailureStatus,
  diagnostic: ProviderFailureClass | undefined,
  httpStatus: number | undefined,
): RadarAdvisoryUiResult {
  if (!diagnostic) return { status };
  return httpStatus !== undefined ? { status, diagnostic, httpStatus } : { status, diagnostic };
}

export type AdvisoryCoreDeps = {
  /** Existing authoritative engine — lib/actions/radar.ts::getProspectQualification. */
  loadQualification: (clientId: string) => Promise<ProspectQualificationResult>;
  /** A minimal, already-authorized display read — never raw rows to the provider. */
  loadDisplayContext: (clientId: string) => Promise<AdvisoryDisplayContext | null>;
  /** The configured provider registry (disabled-by-default). */
  createRegistry: () => ProviderRegistry;
  clock?: () => Date;
  /**
   * The app's CURRENT interface locale — resolved server-side by the
   * caller (lib/i18n/locale.ts::getLocale()), NEVER inferred from
   * prospect data and never a client-supplied auth value. Defaults to
   * "fr" when omitted, matching getLocale()'s own default.
   */
  locale?: Locale;
  /**
   * RADAR INTELLIGENCE V2.1 — Phase B. Loads the OWNER-level Provider
   * Policy. Defaults to the real DB-backed store
   * (provider-policy-store.ts::loadProviderPolicy), which itself never
   * throws and falls back to DEFAULT_PROVIDER_POLICY (AUTO, Anthropic
   * primary, OpenAI fallback, no user selection — today's exact
   * Production routing) whenever no policy row exists, the DB is
   * unreachable, or the stored row fails validation — see that module's
   * docstring for the full fail-closed contract. Tests inject a fake
   * async function here instead of touching a DB. Supersedes Phase A's
   * synchronous `providerPolicy` test-only override.
   */
  loadProviderPolicy?: () => Promise<ProviderPolicy>;
};

export async function produceRadarAdvisory(clientId: string, deps: AdvisoryCoreDeps): Promise<RadarAdvisoryUiResult> {
  if (typeof clientId !== "string" || !isValidUuid(clientId)) {
    logRadarIntelligenceEvent({ source: "advisory_core", code: "INVALID_CLIENT_ID", status: "error" });
    return { status: "error" };
  }

  let qualification: ProspectQualificationResult;
  try {
    qualification = await deps.loadQualification(clientId);
  } catch {
    logRadarIntelligenceEvent({ source: "advisory_core", code: "PRE_GATEWAY_LOADER_FAILURE", status: "error" });
    return { status: "error" };
  }
  if (qualification.qualificationStatus !== "QUALIFIED" || qualification.opportunity === null) {
    return { status: "not_applicable" };
  }
  const opportunity = qualification.opportunity;

  let display: AdvisoryDisplayContext | null;
  try {
    display = await deps.loadDisplayContext(clientId);
  } catch {
    logRadarIntelligenceEvent({ source: "advisory_core", code: "PRE_GATEWAY_LOADER_FAILURE", status: "error" });
    return { status: "error" };
  }
  if (!display) {
    logRadarIntelligenceEvent({ source: "advisory_core", code: "DISPLAY_CONTEXT_NOT_FOUND", status: "error" });
    return { status: "error" };
  }

  const context = sanitizeProspectContext({
    prospectName: display.name,
    company: null,
    sector: display.sector,
    location: display.location,
    stage: display.stage,
    deterministicPriority: opportunity.priority,
    deterministicConfidence: opportunity.confidence,
    deterministicReasonCodes: opportunity.reasons.map((r) => r.code),
    recommendedNextActionCode: opportunity.recommendedNextAction,
    recentInteractionSummaries: display.recentInteractionSummaries,
    openFollowUpCount: display.openFollowUpCount,
    nextFollowUpDueOn: null,
  });

  let outcome;
  try {
    const registry = deps.createRegistry();
    // RADAR INTELLIGENCE V2.1 — Phase B: the OWNER policy itself now
    // comes from the persistent store (provider-policy-store.ts),
    // instead of Phase A's always-DEFAULT_PROVIDER_POLICY constant.
    // `registry.list()` is REGISTRATION truth ("can this provider
    // technically run" — config/credential state, unchanged); the
    // loaded policy is PERMISSION truth ("is this provider allowed, and
    // in what order"). resolveProviderPolicy() intersects both; it never
    // conflates them. `requestedProviderId: null` is still passed
    // unconditionally — there is no user-selection caller yet (Phase D),
    // so an empty/absent DB policy resolves to the exact same AUTO
    // routing Production has always used (loadProviderPolicy()'s own
    // fallback returns DEFAULT_PROVIDER_POLICY, which reproduces
    // DEFAULT_ROUTING_POLICY's shape exactly).
    const registeredProviders = new Set<IntelligenceProviderId>(registry.list().map((adapter) => adapter.id));
    const ownerPolicy = await (deps.loadProviderPolicy ?? loadProviderPolicyFromStore)();
    const resolvedPolicy = resolveProviderPolicy({
      ownerPolicy,
      registeredProviders,
      requestedProviderId: null,
    });
    const router = createProviderRouter({
      registry,
      policy: resolvedPolicy,
      ...(deps.clock ? { clock: deps.clock } : {}),
      // Per-ATTEMPT timeout — the router calls this at most
      // MAX_PROVIDER_ATTEMPTS times (primary, then eligible fallback
      // chain entries), never in a loop.
      timeoutMs: 8_000,
    });
    outcome = await router.run({ kind: "summarize", requiredCapabilities: ["summarize"], context, locale: deps.locale ?? "fr" });
  } catch {
    logRadarIntelligenceEvent({ source: "advisory_core", code: "REGISTRY_GATEWAY_THROW", status: "error" });
    return { status: "error" };
  }

  const deterministic = {
    priority: opportunity.priority,
    confidence: opportunity.confidence,
    recommendedNextAction: opportunity.recommendedNextAction,
  };

  if (outcome.advisory) {
    // A successful FALLBACK is the one success-path event worth a safe
    // log line (mission section 17) — everything logged is already
    // non-secret provider identity + a boolean, same allowlist as the
    // failure log below.
    if (outcome.fallbackUsed) {
      logRadarIntelligenceEvent({ source: "advisory_core", code: "FALLBACK_SUCCEEDED", provider: outcome.advisory.provider, fallbackUsed: true, status: "ok" });
    }
    return {
      status: "ok",
      summary: outcome.advisory.summary ?? "",
      suggestedNextAction: outcome.advisory.suggestedNextAction ?? null,
      risks: outcome.advisory.risks ?? [],
      reasoning: outcome.advisory.reasoning ?? null,
      generatedAt: outcome.advisory.generatedAt ?? outcome.generatedAt,
      deterministic,
      ...(outcome.advisory.model
        ? { providerMeta: { provider: outcome.advisory.provider, model: outcome.advisory.model, fallbackUsed: outcome.fallbackUsed } }
        : {}),
    };
  }

  // Only a real provider transport/response failure carries a failureClass
  // (429/5xx/timeout/network/parse); the designed no-provider states
  // (NO_CAPABLE_PROVIDER, disabled/disconnected) do not, so those results
  // stay byte-identical to before this patch. httpStatus, in turn, is
  // exposed ONLY alongside a failureClass, and only when the provider
  // failure was a genuine 400–599 HTTP response (never a fabricated,
  // inferred, or coerced value — see errors.ts::validateHttpStatus).
  const diagnostic = outcome.error?.failureClass;
  const httpStatus = diagnostic ? outcome.error?.httpStatus : undefined;

  let uiResult: RadarAdvisoryUiResult;
  switch (outcome.error?.code) {
    case "PROVIDER_RATE_LIMITED":
      uiResult = buildFailureResult("rate_limited", diagnostic, httpStatus);
      break;
    case "PROVIDER_TIMEOUT":
      uiResult = buildFailureResult("timeout", diagnostic, httpStatus);
      break;
    case "NO_CAPABLE_PROVIDER":
    case "PROVIDER_UNAVAILABLE":
    case "PROVIDER_DISABLED":
    case "PROVIDER_DISCONNECTED":
      uiResult = buildFailureResult("unavailable", diagnostic, httpStatus);
      break;
    default:
      uiResult = outcome.providerUnavailable && !outcome.error ? { status: "unavailable" } : buildFailureResult("error", diagnostic, httpStatus);
  }

  // Single log seam for every provider-side outcome: the safe enum code,
  // the coarse class + exact status (only when they exist), and the
  // status about to be returned. Never the provider name, request id,
  // prompt, or raw body.
  //
  // providerErrorType/Code/Param (RADAR INTELLIGENCE V2): already
  // independently validated once inside makeIntelligenceError() when
  // outcome.error was constructed, and re-validated AGAIN here by
  // logRadarIntelligenceEvent itself — this call site never trusts
  // outcome.error's fields at face value, same as every other field
  // below. Never the provider's error.message, never the raw body.
  if (outcome.error) {
    logRadarIntelligenceEvent({
      source: "advisory_core",
      code: outcome.error.code,
      ...(diagnostic ? { failureClass: diagnostic } : {}),
      ...(httpStatus !== undefined ? { httpStatus } : {}),
      ...(outcome.providerId ? { provider: outcome.providerId } : {}),
      ...(outcome.fallbackUsed ? { fallbackUsed: true, attempt: outcome.attemptCount } : {}),
      ...(outcome.error.providerErrorType ? { providerErrorType: outcome.error.providerErrorType } : {}),
      ...(outcome.error.providerErrorCode ? { providerErrorCode: outcome.error.providerErrorCode } : {}),
      ...(outcome.error.providerErrorParam ? { providerErrorParam: outcome.error.providerErrorParam } : {}),
      status: uiResult.status,
    });
  }

  return uiResult;
}
