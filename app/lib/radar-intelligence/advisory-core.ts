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
import { loadRadarAiQuotaPolicyWithStatus as loadRadarAiQuotaPolicyFromStore, type RadarAiQuotaPolicyReadResult } from "./quota-policy-store";
import {
  admitGlobalRequestUnit as admitGlobalRequestUnitFromStore,
  incrementGlobalTokenCount as incrementGlobalTokenCountFromStore,
  readGlobalQuotaCounter as readGlobalQuotaCounterFromStore,
  type QuotaCounterSnapshot,
} from "./quota-counter-store";

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
  | { status: "not_applicable" }
  /**
   * RADAR INTELLIGENCE V2.1 — Phase G4B-2. The OWNER-configured AI quota
   * gate denied this request BEFORE any provider registry/router was
   * even constructed — no HTTP call, no fallback, no transport ever ran.
   * Distinct from `"unavailable"` (no provider configured/reachable) and
   * from `"rate_limited"` (a genuine provider-side 429) — `"limited"`
   * means "the OWNER's own AI governance policy said no," never a
   * provider/transport fact. Carries the SAME deterministic block as a
   * successful advisory: a quota block must never take away the
   * authoritative RADAR CORE basis, which was already fully computed
   * before the gate ever ran (mission invariant: RADAR CORE FIRST).
   * `"limited"` intentionally does not distinguish OWNER-disabled vs.
   * daily-request-limit vs. daily-token-limit vs. counter-store-outage
   * in its PUBLIC shape — see observability.ts's AI_QUOTA_* codes for
   * the (server-log-only, never user-facing) internal sub-cause.
   */
  | { status: "limited"; deterministic: { priority: string; confidence: string; recommendedNextAction: string } };

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
  /**
   * RADAR INTELLIGENCE V2.1 — Phase G4B-2 (corrected). Loads the
   * OWNER-configured AI quota policy, WITH an explicit status
   * distinguishing "ok" (a valid stored row) / "missing" (no row yet —
   * a legitimate, expected first-install state, safe to treat as the
   * default) / "error" (a genuine DB read failure or a corrupt stored
   * row — NEVER collapsed into the default; the gate below fails
   * closed on this case specifically). Defaults to the real DB-backed
   * store (quota-policy-store.ts::loadRadarAiQuotaPolicyWithStatus),
   * which itself never throws. Tests inject a fake to force any of the
   * three states.
   */
  loadQuotaPolicy?: () => Promise<RadarAiQuotaPolicyReadResult>;
  /**
   * RADAR INTELLIGENCE V2.1 — Phase G4B-2. Reads the CURRENT global
   * token counter for `now`'s UTC period, without mutating anything —
   * used only for the pre-dispatch token-budget check. Defaults to the
   * real store (quota-counter-store.ts::readGlobalQuotaCounter), whose
   * own contract is to PROPAGATE a DB failure (never fail open) — the
   * gate below treats a rejection here as fail-closed (deny).
   */
  readQuotaCounter?: (now: Date) => Promise<QuotaCounterSnapshot | null>;
  /**
   * RADAR INTELLIGENCE V2.1 — Phase G4B-2. Atomically spends (or
   * refuses to spend) exactly one request-quota unit for `now`'s UTC
   * period, given the OWNER's `dailyRequestLimit` (null/0/positive —
   * see quota-counter-store.ts::admitGlobalRequestUnit's own docstring
   * for the exact semantics of each). Defaults to that real store
   * function, which PROPAGATES a DB failure — treated as fail-closed
   * (deny) here, exactly like `readQuotaCounter`.
   */
  admitRequestUnit?: (dailyRequestLimit: number | null, now: Date) => Promise<boolean>;
  /**
   * RADAR INTELLIGENCE V2.1 — Phase G4B-2. Best-effort, atomic POST-hoc
   * token-count increment after a genuinely successful provider
   * response (see the call site below for why this is intentionally
   * NEVER awaited in a way that can take back an already-good result —
   * mirrors telemetry's own "never block on this" contract, unlike the
   * PRE-dispatch gate above, which is deliberately the opposite:
   * fail-closed). Defaults to the real store
   * (quota-counter-store.ts::incrementGlobalTokenCount).
   */
  incrementQuotaTokens?: (delta: number, now: Date) => Promise<QuotaCounterSnapshot>;
};

type QuotaGateInternalCode = "AI_QUOTA_DISABLED" | "AI_QUOTA_REQUEST_LIMIT_REACHED" | "AI_QUOTA_TOKEN_LIMIT_REACHED" | "AI_QUOTA_COUNTER_UNAVAILABLE" | "AI_QUOTA_POLICY_UNAVAILABLE";
type QuotaGateDecision = { admitted: true } | { admitted: false; internalCode: QuotaGateInternalCode };

/**
 * RADAR INTELLIGENCE V2.1 — Phase G4B-2 — the AI quota gate. Called
 * exactly ONCE per `produceRadarAdvisory()` invocation, AFTER
 * `resolvedPolicy` is computed and BEFORE `createProviderRouter(...)` is
 * ever constructed (see the call site below) — so a denial here means
 * ZERO registry/router construction, ZERO provider dispatch, ZERO
 * fallback, for every one of the internal reasons below.
 *
 * ORDER (mission-specified): (1) load policy — a genuine STORE FAILURE
 * fails closed outright (see the G4B-2 correction below); `enabled:
 * false` denies outright too, but for a different, OWNER-deliberate
 * reason; (2) token pre-check — a best-effort read against the OWNER's
 * `dailyTokenLimit` (tokens are only known AFTER a provider responds,
 * so this can only ever gate FUTURE requests, never the exact cost of
 * the current one — an explicitly accepted, documented property, not a
 * bug); (3) request-quota atomic admission — the one step that actually
 * SPENDS a unit, via quota-counter-store.ts::admitGlobalRequestUnit,
 * which encapsulates the null/0/positive branching so this function
 * never constructs SQL itself.
 *
 * FAIL-CLOSED, CORRECTED (RADAR INTELLIGENCE V2.1 — Phase G4B-2
 * targeted correction): the ORIGINAL version of this function called
 * `loadQuotaPolicy` expecting a plain `RadarAiQuotaPolicy` — since
 * quota-policy-store.ts's OLD read contract collapsed "no row"
 * (legitimate, first-install) and "DB read failure" (a genuine outage)
 * into the SAME silent `DEFAULT_RADAR_AI_QUOTA_POLICY` (enabled,
 * unlimited), a real policy-store outage was indistinguishable from
 * "nothing configured yet" and this gate would ADMIT every request
 * during that outage — exactly the unbounded-spend risk this mission
 * exists to prevent. `deps.loadQuotaPolicy` now returns the
 * status-aware `RadarAiQuotaPolicyReadResult`
 * (quota-policy-store.ts::loadRadarAiQuotaPolicyWithStatus), and this
 * gate branches on `status` explicitly:
 *   - `"ok"` / `"missing"` -> use `policy` exactly as before (a
 *     genuinely absent row is NOT an outage — see that store's own
 *     docstring for why treating "never configured" as unlimited
 *     remains the correct, documented default);
 *   - `"error"` -> FAIL CLOSED immediately, `AI_QUOTA_POLICY_UNAVAILABLE`
 *     — no token pre-check, no request-quota admission, no router.
 * `readQuotaCounter`/`admitRequestUnit` rejecting (the counter store's
 * own contract: propagate a DB failure, never fail open) is still
 * caught here and treated as `AI_QUOTA_COUNTER_UNAVAILABLE` — a
 * DIFFERENT internal code from the policy-store case above, so the two
 * distinct outages are never confused with one another in logs, even
 * though both resolve to the same public `{ status: "limited" }`.
 */
async function evaluateAiQuotaGate(deps: AdvisoryCoreDeps, now: Date): Promise<QuotaGateDecision> {
  let policyResult: RadarAiQuotaPolicyReadResult;
  try {
    policyResult = await (deps.loadQuotaPolicy ?? loadRadarAiQuotaPolicyFromStore)();
  } catch {
    // Defensive only: the real implementation's contract is "never
    // throw, always return a status" — but a thrown value (e.g. from a
    // test fake, or from a future change to that contract) must fail
    // closed here exactly like an explicit `status: "error"`, never
    // propagate up and be mistaken for a different failure mode.
    return { admitted: false, internalCode: "AI_QUOTA_POLICY_UNAVAILABLE" };
  }
  if (policyResult.status === "error") {
    return { admitted: false, internalCode: "AI_QUOTA_POLICY_UNAVAILABLE" };
  }
  const policy = policyResult.policy;

  if (!policy.enabled) {
    return { admitted: false, internalCode: "AI_QUOTA_DISABLED" };
  }

  if (policy.dailyTokenLimit !== null) {
    let snapshot: QuotaCounterSnapshot | null;
    try {
      snapshot = await (deps.readQuotaCounter ?? readGlobalQuotaCounterFromStore)(now);
    } catch {
      return { admitted: false, internalCode: "AI_QUOTA_COUNTER_UNAVAILABLE" };
    }
    const tokensSoFar = snapshot?.tokenCount ?? 0;
    if (tokensSoFar >= policy.dailyTokenLimit) {
      return { admitted: false, internalCode: "AI_QUOTA_TOKEN_LIMIT_REACHED" };
    }
  }

  let admitted: boolean;
  try {
    admitted = await (deps.admitRequestUnit ?? admitGlobalRequestUnitFromStore)(policy.dailyRequestLimit, now);
  } catch {
    return { admitted: false, internalCode: "AI_QUOTA_COUNTER_UNAVAILABLE" };
  }
  if (!admitted) {
    return { admitted: false, internalCode: "AI_QUOTA_REQUEST_LIMIT_REACHED" };
  }

  return { admitted: true };
}

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
  // Hoisted here (Phase G4B-2) from its previous position after the
  // router call: this block depends ONLY on `opportunity`, already
  // available at this point, and the new quota gate below (which can
  // return before the router is ever constructed) needs the SAME
  // deterministic block a successful advisory returns — RADAR CORE
  // FIRST means a quota block can never omit it.
  const deterministic = {
    priority: opportunity.priority,
    confidence: opportunity.confidence,
    recommendedNextAction: opportunity.recommendedNextAction,
  };

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

    // RADAR INTELLIGENCE V2.1 — Phase G4B-2 — the AI quota gate. Evaluated
    // exactly once per call, AFTER resolvedPolicy (so it applies uniformly
    // whether `requestedProviderId` was explicit or automatic — neither
    // can bypass it) and BEFORE the router is ever constructed below — a
    // denial here means zero registry/router construction, zero provider
    // dispatch, zero fallback. See evaluateAiQuotaGate()'s own docstring
    // for the full ordering/fail-closed contract.
    const quotaGate = await evaluateAiQuotaGate(deps, nowFn());
    if (!quotaGate.admitted) {
      logRadarIntelligenceEvent({ source: "advisory_core", code: quotaGate.internalCode, status: "limited" });
      return { status: "limited", deterministic };
    }

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

  // RADAR INTELLIGENCE V2.1 — Phase G4B-2: POST-hoc, atomic, best-effort
  // token-count increment — reads exactly like G3A's own canonical
  // metric (token-accounting.ts): only a genuinely successful, tokens-
  // producing outcome contributes; a failed/no-provider outcome
  // contributes 0, never a fabricated value. Deliberately the OPPOSITE
  // fail-safe direction from the gate above: a failure HERE must never
  // take back an already-good user-facing advisory (mirrors telemetry's
  // own "never block on this" contract) — this is bookkeeping for
  // FUTURE requests' token pre-check, not a decision about this one.
  // Never opens/holds a transaction across the provider call above:
  // this runs strictly AFTER `outcome` already resolved.
  if (outcome.advisory) {
    try {
      const tokensUsed = (outcome.advisory.usage?.inputTokens ?? 0) + (outcome.advisory.usage?.outputTokens ?? 0);
      if (tokensUsed > 0) {
        const increment = deps.incrementQuotaTokens ?? incrementGlobalTokenCountFromStore;
        await increment(tokensUsed, nowFn());
      }
    } catch {
      // Best-effort — see this block's own docstring above.
    }
  }

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
