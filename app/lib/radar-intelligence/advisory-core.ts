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
import { recordRadarAiProviderAttempt as recordRadarAiProviderAttemptToStore, type RadarAiProviderAttemptTelemetryInput } from "./provider-attempt-telemetry-store";

/**
 * RADAR INTELLIGENCE V2.1 — Phase G2 — a per-`produceRadarAdvisory()`-call
 * correlation id, distinct from the gateway's own PER-ATTEMPT `requestId`
 * (gateway.ts mints a fresh one on every single `gateway.run()` call,
 * i.e. once per provider dispatch — see provider-attempt-telemetry-store.ts's
 * own docstring on this distinction). Mirrors gateway.ts's own
 * `defaultRequestId()` shape/style for consistency; not security
 * sensitive, never used for authorization.
 */
function defaultAiRequestId(): string {
  return `air_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}

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
  /**
   * RADAR INTELLIGENCE V2.1 — Phase G2. The acting staff member's
   * session user id (requireSession().userId in the real caller) —
   * NEVER a client-supplied value. Used ONLY to stamp operational
   * telemetry (`actorUserId`); never used for authorization (that
   * already happened before this function was ever called) and never
   * forwarded to a provider. `null`/omitted degrades to an anonymous
   * telemetry row (actorUserId: null) rather than throwing.
   */
  actorUserId?: string | null;
  /**
   * RADAR INTELLIGENCE V2.1 — Phase G2. Mints the STABLE per-advisory-
   * request correlation id used only for telemetry — see
   * `defaultAiRequestId()`'s own docstring for why this is distinct from
   * the gateway's own per-ATTEMPT requestId. Tests inject a deterministic
   * fake; production omits it and gets the real generator.
   */
  generateAiRequestId?: () => string;
  /**
   * RADAR INTELLIGENCE V2.1 — Phase G2. Records ONE best-effort,
   * fail-safe provider-attempt telemetry row. Defaults to the real
   * DB-backed store (provider-attempt-telemetry-store.ts), which itself
   * never throws. Tests inject a fake to observe what would have been
   * recorded without touching a DB. This is an OBSERVER only — it is
   * never awaited in a way that can affect the returned
   * RadarAdvisoryUiResult, and its own failure is caught independently
   * either way (see the call site below).
   */
  recordProviderAttempt?: (input: RadarAiProviderAttemptTelemetryInput) => Promise<void>;
};

/**
 * RADAR INTELLIGENCE V2.1 — Phase D. Optional, request-scoped provider
 * preference. `requestedProviderId` MUST already be server-validated by
 * the caller (lib/actions/radar-intelligence.ts narrows any raw client
 * value through isPolicyConfigurableProviderId() BEFORE it ever reaches
 * this function) — this parameter is never a raw client string branched
 * on directly here. `undefined`/`null` (the only value every pre-Phase-D
 * caller passes) means "no preference", producing byte-identical AUTO
 * routing to before this parameter existed. Forwarded verbatim into
 * resolveProviderPolicy() (provider-policy.ts), which is ALREADY
 * fail-closed against any unusable/unauthorized/forged id — an invalid
 * preference silently degrades to the exact same AUTO result a caller
 * with no preference would get, never a throw, never a distinguishing
 * signal.
 */
export async function produceRadarAdvisory(
  clientId: string,
  deps: AdvisoryCoreDeps,
  requestedProviderId?: IntelligenceProviderId | null,
): Promise<RadarAdvisoryUiResult> {
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

  // RADAR INTELLIGENCE V2.1 — Phase G2: minted ONCE per advisory request,
  // before the router ever runs — the stable correlation id every
  // telemetry row for this request will share (see defaultAiRequestId()'s
  // own docstring for why this differs from the gateway's per-attempt id).
  const aiRequestId = (deps.generateAiRequestId ?? defaultAiRequestId)();
  const nowFn = deps.clock ?? (() => new Date());
  const attemptStartedAt = nowFn();

  let outcome;
  try {
    const registry = deps.createRegistry();
    // RADAR INTELLIGENCE V2.1 — Phase B: the OWNER policy itself comes
    // from the persistent store (provider-policy-store.ts), instead of
    // Phase A's always-DEFAULT_PROVIDER_POLICY constant. `registry.list()`
    // is REGISTRATION truth ("can this provider technically run" —
    // config/credential state, unchanged); the loaded policy is
    // PERMISSION truth ("is this provider allowed, and in what order").
    // resolveProviderPolicy() intersects both; it never conflates them.
    //
    // Phase D: `requestedProviderId` (see this function's own docstring)
    // is now forwarded verbatim instead of being hardcoded `null`. Every
    // caller that omits it (every caller that existed before Phase D)
    // gets `undefined`, which resolveProviderPolicy() treats exactly like
    // `null` — so an empty/absent DB policy still resolves to the exact
    // same AUTO routing Production has always used, byte-identical to
    // before this parameter existed.
    const registeredProviders = new Set<IntelligenceProviderId>(registry.list().map((adapter) => adapter.id));
    const ownerPolicy = await (deps.loadProviderPolicy ?? loadProviderPolicyFromStore)();
    const resolvedPolicy = resolveProviderPolicy({
      ownerPolicy,
      registeredProviders,
      requestedProviderId: requestedProviderId ?? null,
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

  // RADAR INTELLIGENCE V2.1 — Phase G2: OBSERVE the outcome the router
  // already decided — this layer never influences routing/fallback/
  // eligibility, it only records what already happened. Recorded ONLY
  // when at least one real provider dispatch occurred (attemptCount >= 1
  // and a real providerId is known) — the designed "nothing configured"
  // no-op state (attemptCount === 0) is not a "provider attempt" and is
  // deliberately never recorded here (see provider-attempt-telemetry-store.ts's
  // own docstring). This entire block is best-effort and isolated from
  // the function's own return value: any failure here (including a
  // thrown test fake) is caught immediately below and never propagates.
  if (outcome.attemptCount >= 1 && outcome.providerId !== null) {
    try {
      const latencyMs = Math.max(0, nowFn().getTime() - attemptStartedAt.getTime());
      const record = deps.recordProviderAttempt ?? recordRadarAiProviderAttemptToStore;
      await record({
        aiRequestId,
        actorUserId: deps.actorUserId ?? null,
        providerId: outcome.providerId,
        modelId: outcome.advisory?.model ?? null,
        selectionMode: requestedProviderId ? "explicit" : "automatic",
        status: outcome.advisory ? "success" : "failure",
        errorCode: outcome.error?.code ?? null,
        failureClass: outcome.error?.failureClass ?? null,
        httpStatus: outcome.error?.httpStatus ?? null,
        latencyMs,
        attemptCount: outcome.attemptCount,
        fallbackUsed: outcome.fallbackUsed,
        inputTokens: outcome.advisory?.usage?.inputTokens ?? null,
        outputTokens: outcome.advisory?.usage?.outputTokens ?? null,
        providerRequestId: outcome.advisory?.usage?.providerRequestId ?? null,
      });
    } catch {
      // Never let a telemetry failure (even one injected by a test
      // fake) reach the caller — the advisory result below is already
      // fully computed regardless.
    }
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
