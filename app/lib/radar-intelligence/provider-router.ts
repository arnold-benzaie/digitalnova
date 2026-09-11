/**
 * RADAR INTELLIGENCE V2 — the provider router.
 *
 * The ONE place that knows there is a "primary" and a "fallback"
 * provider. It sits BETWEEN advisory-core and the (already
 * provider-agnostic) gateway:
 *
 *   RADAR Core -> RADAR Intelligence Gateway -> Provider Router
 *     -> [Anthropic Adapter, OpenAI Adapter] -> normalized IntelligenceAdvisory
 *     -> existing Advisory Core / UI
 *
 * It does NOT re-implement HTTP, timeout, or normalization logic: each
 * attempt is a normal `RadarIntelligenceGateway.run()` call — the exact
 * same gateway every single-provider flow already uses, scoped (via
 * `isolateProvider`) to ONLY the one adapter being attempted, so its
 * result is unambiguous ("primary's own failure", not "whichever
 * provider the registry happened to prefer"). The router adds ONLY the
 * routing DECISION (try primary; on an approved failure condition, try
 * the fallback once) and lightweight routing metadata
 * (`fallbackUsed`, `attemptCount`) — everything else (timeout policy,
 * circuit breaker, error normalization, response parsing) is unchanged,
 * shared code.
 *
 * HARD LIMITS (mission section 9 — no hidden retries):
 *  - at most ONE call to the primary adapter,
 *  - at most ONE call to the fallback adapter,
 *  - so at most TWO provider HTTP calls, ever, per advisory request,
 *  - no loop, no recursion, no background retry.
 * `run()` is a single straight-line function with exactly two possible
 * gateway.run() call sites — this is structurally provable by reading the
 * function, and verified by call-count assertions in
 * provider-router.test.mjs.
 *
 * FALLBACK ELIGIBILITY (mission section 8 — do not fallback blindly):
 * allowed only for "the primary genuinely could not be reached or
 * finished" — unavailable, timeout, a 5xx, a network fault, or the
 * primary simply not being configured/enabled at all (NO_CAPABLE_PROVIDER
 * / PROVIDER_DISABLED / PROVIDER_DISCONNECTED — this last case isn't a
 * "failure" in the everyday sense, it's the ordinary "primary is off"
 * state, and hiding a genuinely reachable second provider behind an
 * unconfigured first one would defeat the entire point of a
 * multi-provider foundation). NEVER for a 4xx (400/401/403/404/...), a
 * 429 rate-limit, a local validation error, or an unparseable response —
 * those are visible, specific problems with the PRIMARY's own
 * configuration or the request itself, and hiding them behind a silent
 * fallback would make an auth/config mistake invisible (mission section
 * 15). See isFallbackEligible() below for the exact rule.
 *
 * PRIMARY-ABSENT FIX (diagnosed after the V2 push): when the primary is
 * disabled/unconfigured, `deps.registry` never even contains it —
 * `configured-registry.ts` only registers a provider once it is BOTH
 * enabled AND keyed. In that case `isolateProvider` below builds a
 * genuinely EMPTY gateway registry (not even the deterministic adapter),
 * so `gateway.run()`'s selection resolves NO_CAPABLE_PROVIDER, which the
 * gateway then deliberately COLLAPSES to `deterministicOutcome()` —
 * `error: null` — because that is Slice-1's designed, non-error
 * "nothing configured" state. `isFallbackEligible(null)` correctly
 * returns `false` (a null error is never, by itself, a reason to try a
 * second provider) — but that meant a primary that was simply never
 * registered could never reach the fallback either, even though the
 * module docstring above always intended it to. The fix does NOT touch
 * `isFallbackEligible` or broaden what a null error means in general —
 * it adds ONE additional, narrowly-scoped signal computed directly from
 * `deps.registry.has(policy.primary)` (captured as `primaryRegistered`,
 * already computed for `attemptCount` bookkeeping): a primary that was
 * never registered is unconditionally fallback-eligible, independent of
 * whatever `primaryOutcome.error` happens to be. A primary that WAS
 * registered still goes through `isFallbackEligible(primaryOutcome.error)`
 * exactly as before — this change never affects that branch.
 *
 * V2.1 — N-PROVIDER GENERALIZATION (Phase A — Provider Policy domain
 * foundation, see provider-policy.ts): the 2-slot `{primary, fallback}`
 * pair generalizes to `{primary, fallbackChain}` — an ordered list the
 * router walks in sequence, reusing the EXACT SAME per-attempt mechanism
 * (`isolateProvider` + a single-attempt gateway) and the EXACT SAME
 * `isFallbackEligible` rule at every step, never broadened. Three
 * structural guarantees survive the generalization unchanged:
 *  - HARD CAP: at most `MAX_PROVIDER_ATTEMPTS` (2) providers are ever
 *    dispatched to, however long `fallbackChain` is — a longer chain
 *    only ever matters if an EARLIER entry was itself never registered
 *    (costing zero attempts, per the primary-absent fix above).
 *  - NO DUPLICATE ATTEMPTS: `primary` and every already-attempted
 *    `fallbackChain` entry are tracked in a `Set` and skipped if seen
 *    again — a chain that repeats an id (deliberately or via a naive
 *    OWNER-authored list) can never be dispatched to twice.
 *  - `primary: null` (the resolver's "no provider usable at all" case)
 *    flows through the SAME `isolateProvider(registry, id)` path an
 *    absent-but-non-null id already used — `isolateProvider` already
 *    tolerated `id: IntelligenceProviderId | null` before this change —
 *    so it collapses to the identical safe `deterministicOutcome()`
 *    shape with zero new special-case code and zero duplicated logic.
 * `ResolvedProviderPolicy` (provider-policy.ts) is a structural SUPERSET
 * of the `RoutingPolicy` shape below — a resolver result can be passed
 * directly as this router's `policy`, so there is exactly one routing
 * decision, never two shapes that could disagree.
 */
import { createRadarIntelligenceGateway, type GatewayClock } from "./gateway";
import type { IntelligenceError } from "./errors";
import type { IntelligenceOutcome, IntelligenceProviderId, IntelligenceRequest } from "./types";
import { createProviderRegistry, type ProviderRegistry } from "./provider-registry";

/**
 * The routing shape the router itself consumes. `primary: null` means
 * "no usable provider at all" (see the V2.1 docstring note above) —
 * distinct from "a real id that happens not to be registered yet",
 * which the primary-absent fix already handles via `primaryRegistered`.
 * `fallbackChain` generalizes the old single `fallback: ProviderId|null`
 * slot to an ordered list of any length; `MAX_PROVIDER_ATTEMPTS` below
 * is what actually bounds cost, not the chain's length.
 */
export type RoutingPolicy = {
  primary: IntelligenceProviderId | null;
  fallbackChain: readonly IntelligenceProviderId[];
};

/**
 * The default V1/V2 routing policy: try Anthropic first; OpenAI is the
 * only entry in the fallback chain. A future provider is added to the
 * registry (adapters/index.ts) and, if desired, appended to a NEW named
 * policy's `fallbackChain` — this default is not the only one
 * `createProviderRouter` can express, but it is the only one Production
 * activates as of V2.1 Phase A (via provider-policy.ts's
 * DEFAULT_PROVIDER_POLICY, which resolves to this exact shape).
 */
export const DEFAULT_ROUTING_POLICY: RoutingPolicy = Object.freeze({
  primary: "anthropic",
  fallbackChain: Object.freeze<IntelligenceProviderId[]>(["openai"]),
});

/**
 * HARD CEILING on provider dispatches per `run()` call, regardless of
 * `fallbackChain`'s length — "no hidden retries" stays structural, not a
 * caller convention, even as N-provider fallback chains grow. Today's
 * 2-provider flow (Anthropic + OpenAI) already saturates this cap
 * exactly; a longer future chain (Gemini, DeepSeek, ...) never gets a
 * 3rd dispatch in the same request.
 */
export const MAX_PROVIDER_ATTEMPTS = 2;

/** The gateway's own IntelligenceOutcome, augmented with non-secret
 * routing metadata. Every existing consumer of IntelligenceOutcome
 * (advisory-core.ts's switch on `.error?.code`, `.advisory`,
 * `.providerUnavailable`) keeps working unchanged — these two fields are
 * purely additive. */
export type RoutedIntelligenceOutcome = IntelligenceOutcome & {
  /** Whether the FALLBACK provider ended up serving this request. */
  fallbackUsed: boolean;
  /** How many providers were actually dispatched to (0, 1, or 2) — 0
   * only when the primary was never even configured/registered. */
  attemptCount: number;
};

/**
 * The narrow set of failure conditions allowed to trigger a fallback
 * attempt (mission section 8's explicit list, plus the "primary isn't
 * configured at all" state — see the module docstring above). Every
 * other IntelligenceErrorCode (INVALID_INTELLIGENCE_REQUEST,
 * PROVIDER_RATE_LIMITED, or a PROVIDER_ERROR whose failureClass is
 * PROVIDER_4XX / PROVIDER_PARSE / PROVIDER_UNKNOWN / absent) is NOT
 * eligible — an auth/config/validation mistake stays visible, exactly as
 * mission section 15 requires. 429 is deliberately excluded per mission
 * section 8 ("Otherwise keep 429 non-fallback in V2").
 */
const ALWAYS_ELIGIBLE_CODES = new Set(["NO_CAPABLE_PROVIDER", "PROVIDER_DISABLED", "PROVIDER_DISCONNECTED", "PROVIDER_UNAVAILABLE", "PROVIDER_TIMEOUT"]);
const ELIGIBLE_FAILURE_CLASSES = new Set(["PROVIDER_5XX", "PROVIDER_NETWORK"]);

export function isFallbackEligible(error: IntelligenceError | null): boolean {
  if (!error) return false; // success — no fallback needed
  if (ALWAYS_ELIGIBLE_CODES.has(error.code)) return true;
  if (error.failureClass && ELIGIBLE_FAILURE_CLASSES.has(error.failureClass)) return true;
  return false;
}

/** A registry containing, at most, the ONE named adapter from `registry`
 * (or none, if it isn't registered/configured) — so a gateway built on
 * top of it can only ever resolve to that provider or the clean
 * no-provider state. This is what makes "attempt the primary" and
 * "attempt the fallback" unambiguous single-provider gateway calls. */
function isolateProvider(registry: ProviderRegistry, id: IntelligenceProviderId | null): ProviderRegistry {
  const isolated = createProviderRegistry();
  const adapter = id ? registry.get(id) : undefined;
  if (adapter) isolated.register(adapter);
  return isolated;
}

export type ProviderRouterDeps = {
  registry: ProviderRegistry;
  policy?: RoutingPolicy;
  /** Per-attempt timeout, forwarded to the gateway unchanged — the router
   * introduces no timeout logic of its own. */
  timeoutMs: number;
  clock?: GatewayClock;
  generateRequestId?: () => string;
};

async function runOneAttempt(
  registry: ProviderRegistry,
  // `null` is accepted so the resolver's "no provider usable at all"
  // case (ResolvedProviderPolicy.primary === null) can flow through the
  // EXACT SAME isolateProvider() path an absent-but-non-null id already
  // used, resolving to the identical safe deterministicOutcome() shape
  // with zero new special-case code.
  id: IntelligenceProviderId | null,
  request: IntelligenceRequest,
  timeoutMs: number,
  clock: GatewayClock | undefined,
  generateRequestId: (() => string) | undefined,
): Promise<IntelligenceOutcome> {
  const gateway = createRadarIntelligenceGateway({
    registry: isolateProvider(registry, id),
    ...(clock ? { clock } : {}),
    ...(generateRequestId ? { generateRequestId } : {}),
    // Hard-coded, non-configurable: the router itself never introduces a
    // retry loop on top of a single attempt — "no hidden retries" is
    // structural here, not merely a caller convention.
    policy: { timeoutMs, maxRetries: 0, retryBaseDelayMs: 0, retryableCodes: new Set() },
  });
  return gateway.run(request);
}

/**
 * Build the router. `run(request)` performs AT MOST `MAX_PROVIDER_ATTEMPTS`
 * provider dispatches — the primary, then (only while eligible, in
 * OWNER-defined order, de-duplicated, and hard-capped) entries from
 * `fallbackChain` — and resolves the SAME IntelligenceOutcome shape the
 * gateway already produces, plus `fallbackUsed` / `attemptCount`.
 */
export function createProviderRouter(deps: ProviderRouterDeps) {
  const policy = deps.policy ?? DEFAULT_ROUTING_POLICY;

  return {
    async run(request: IntelligenceRequest): Promise<RoutedIntelligenceOutcome> {
      // `primaryRegistered` is an independent, direct signal — "this
      // provider does not even exist in the registry" — checked BEFORE
      // trusting `primaryOutcome.error` alone. A registered primary still
      // goes through the ordinary isFallbackEligible(...) check
      // unchanged; only a genuinely absent (or null) primary
      // short-circuits straight to eligible, since the gateway's own
      // no-provider collapse (deterministicOutcome -> error: null) would
      // otherwise make isFallbackEligible(null) report false and hide it.
      const primaryRegistered = policy.primary !== null && deps.registry.has(policy.primary);
      const primaryOutcome = await runOneAttempt(deps.registry, policy.primary, request, deps.timeoutMs, deps.clock, deps.generateRequestId);

      if (primaryOutcome.advisory) {
        return { ...primaryOutcome, fallbackUsed: false, attemptCount: primaryRegistered ? 1 : 0 };
      }

      let eligible = !primaryRegistered || isFallbackEligible(primaryOutcome.error);
      let lastOutcome: IntelligenceOutcome = primaryOutcome;
      let attemptCount = primaryRegistered ? 1 : 0;
      let fallbackUsed = false;
      // Seeded with the primary (when non-null) so it can never be
      // re-attempted if it also appears inside fallbackChain.
      const attempted = new Set<IntelligenceProviderId>(policy.primary !== null ? [policy.primary] : []);

      for (const candidate of policy.fallbackChain) {
        // HARD CAP — never more than MAX_PROVIDER_ATTEMPTS dispatches,
        // however long fallbackChain is.
        if (attemptCount >= MAX_PROVIDER_ATTEMPTS) break;
        // NO DUPLICATE ATTEMPTS — skip an id already attempted (the
        // primary, or an earlier fallbackChain entry), without
        // consuming a cap slot or a loop iteration's "give up" check.
        if (attempted.has(candidate)) continue;
        // The primary's (or the previous candidate's) failure must
        // remain fallback-eligible for the NEXT candidate to be tried
        // at all — this is the exact same rule at every step, never
        // broadened for a longer chain.
        if (!eligible) break;
        // Mirrors the old `fallbackRegistered` gate exactly: an
        // unregistered candidate is never dispatched to and never
        // consumes an attempt — try the next chain entry instead.
        if (!deps.registry.has(candidate)) continue;

        attempted.add(candidate);
        const outcome = await runOneAttempt(deps.registry, candidate, request, deps.timeoutMs, deps.clock, deps.generateRequestId);
        attemptCount += 1;
        fallbackUsed = true;
        lastOutcome = outcome;

        if (outcome.advisory) {
          return { ...outcome, fallbackUsed: true, attemptCount };
        }
        eligible = isFallbackEligible(outcome.error);
      }

      return { ...lastOutcome, fallbackUsed, attemptCount };
    },
  };
}
