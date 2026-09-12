/**
 * RADAR INTELLIGENCE V2.1 — Phase A — Provider Policy domain.
 *
 * PURE DOMAIN MODULE: no DB, no env, no session, no logging, no network,
 * no side effects anywhere in this file. This is the seed of OWNER-level
 * "which providers are permitted, in what order, and can a user choose
 * one" governance — entirely separate from provider REGISTRATION ("can
 * this provider technically run right now"), which stays owned by
 * config-loader.ts / configured-registry.ts / the provider registry,
 * completely unchanged by this file. Provider Policy never means "this
 * provider has credentials" — the resolver below INTERSECTS the two
 * concepts; it never conflates them.
 *
 * PHASE A SCOPE: this module introduces the domain types and a pure
 * resolver only. Production uses ONLY DEFAULT_PROVIDER_POLICY (AUTO,
 * Anthropic primary, OpenAI fallback — byte-identical to today's
 * hardcoded DEFAULT_ROUTING_POLICY in provider-router.ts). No DB
 * persistence, no OWNER settings UI, no user-facing selector, and no
 * Gemini/other-provider registration exist yet — those are later,
 * separately authorized phases (B/C/D/E per the V2.1 architecture
 * discovery). No secret, credential, database id, staff id, or
 * timestamp ever appears in this file's types — those belong to a later
 * persistence layer that WRAPS ProviderPolicy, never to the domain type
 * itself.
 *
 * MANUAL mode is fully implemented HERE, in the pure resolver, because
 * it costs nothing to get right in the domain layer now — doing so means
 * a later Phase D (the real user-selector UI/server-action wiring) is a
 * thin integration, not a redesign. But NO Production caller passes a
 * `requestedProviderId` in Phase A: advisory-core.ts always resolves
 * with `requestedProviderId: null`, so AUTO/default behavior is the
 * only reachable path in Production today.
 */
import type { IntelligenceProviderId } from "./types";

export type ProviderMode = "AUTO" | "MANUAL";

/**
 * OWNER-level, secret-free governance config.
 */
export type ProviderPolicy = {
  mode: ProviderMode;
  /** AUTO's primary pick, when usable. null → the resolver falls back to
   * the first usable entry of fallbackOrder. */
  defaultProvider: IntelligenceProviderId | null;
  /** OWNER-defined order fallback is attempted in, AUTO mode. */
  fallbackOrder: readonly IntelligenceProviderId[];
  /** The global allowlist — a provider absent here can NEVER be selected
   * or used, regardless of its registration/credential state. */
  enabledProviders: readonly IntelligenceProviderId[];
  /** Subset of enabledProviders a user may explicitly request. Always
   * checked in ADDITION to enabledProviders, never instead of it. */
  userSelectableProviders: readonly IntelligenceProviderId[];
  /** Master switch for exposing ANY selector to users at all. */
  allowUserSelection: boolean;
  /** Master switch for cross-provider fallback. false → a MANUAL or AUTO
   * primary failure is returned as-is, never silently retried on a
   * different provider. */
  fallbackEnabled: boolean;
};

/**
 * The safe, in-code default — reproduces TODAY'S Production behavior
 * exactly (Anthropic primary, OpenAI fallback, no user selection). This
 * is the ONLY policy any Production caller uses in Phase A. Deep-frozen:
 * no runtime code can mutate it, matching ROLE_PERMISSIONS's convention
 * in lib/rbac/permissions.ts.
 */
export const DEFAULT_PROVIDER_POLICY: ProviderPolicy = Object.freeze({
  mode: "AUTO",
  defaultProvider: "anthropic",
  fallbackOrder: Object.freeze<IntelligenceProviderId[]>(["anthropic", "openai"]),
  enabledProviders: Object.freeze<IntelligenceProviderId[]>(["anthropic", "openai"]),
  userSelectableProviders: Object.freeze<IntelligenceProviderId[]>([]),
  allowUserSelection: false,
  fallbackEnabled: true,
});

export type ResolvedPolicySource = "auto-default" | "user-manual" | "user-manual-invalid-fallback-to-auto" | "no-provider-available";

/**
 * What the router actually consumes. `primary`/`fallbackChain` are a
 * structural SUBSET of this shape (see provider-router.ts's
 * RoutingPolicy) — a ResolvedProviderPolicy value can be passed directly
 * wherever a RoutingPolicy is expected, so there is exactly ONE routing
 * decision made, never two competing shapes that could disagree.
 */
export type ResolvedProviderPolicy = {
  primary: IntelligenceProviderId | null;
  fallbackChain: readonly IntelligenceProviderId[];
  fallbackEnabled: boolean;
  source: ResolvedPolicySource;
};

export type ResolveProviderPolicyInput = {
  ownerPolicy: ProviderPolicy;
  /** Providers actually registered right now — real config/credential
   * state, entirely independent of ownerPolicy. The resolver INTERSECTS
   * the two; it never trusts either one alone. */
  registeredProviders: ReadonlySet<IntelligenceProviderId>;
  /** A caller-resolved, already-server-trusted preference — NEVER a raw
   * client string branched on directly by this function's caller. null
   * or omitted = no preference (the only value any Production caller
   * passes in Phase A). */
  requestedProviderId?: IntelligenceProviderId | null;
};

/**
 * PURE. No DB, no env, no logging, no session, no network, no mutation
 * of any input (every derived list is a fresh array from `.filter()`).
 * Deterministic and fail-closed: an unusable / unknown / unauthorized
 * `requestedProviderId` NEVER throws and NEVER becomes authorization —
 * it silently degrades to the exact same AUTO resolution a caller with
 * no preference at all would get. No enumeration signal: an invalid id
 * and a valid-but-currently-unavailable id resolve through the identical
 * code path to the identical safe result.
 */
export function resolveProviderPolicy(input: ResolveProviderPolicyInput): ResolvedProviderPolicy {
  const { ownerPolicy, registeredProviders, requestedProviderId } = input;

  const usable = ownerPolicy.enabledProviders.filter((p) => registeredProviders.has(p));

  if (usable.length === 0) {
    return { primary: null, fallbackChain: [], fallbackEnabled: false, source: "no-provider-available" };
  }

  const isUsable = (id: IntelligenceProviderId): boolean => usable.includes(id);

  if (
    ownerPolicy.allowUserSelection &&
    requestedProviderId != null &&
    ownerPolicy.userSelectableProviders.includes(requestedProviderId) &&
    isUsable(requestedProviderId)
  ) {
    const rest = usable.filter((p) => p !== requestedProviderId);
    return {
      primary: requestedProviderId,
      fallbackChain: ownerPolicy.fallbackEnabled ? rest : [],
      fallbackEnabled: ownerPolicy.fallbackEnabled,
      source: "user-manual",
    };
  }

  const defaultProvider = ownerPolicy.defaultProvider !== null && isUsable(ownerPolicy.defaultProvider) ? ownerPolicy.defaultProvider : usable[0];
  const orderedUsable = ownerPolicy.fallbackOrder.filter((p) => isUsable(p));
  const rest = orderedUsable.filter((p) => p !== defaultProvider);

  return {
    primary: defaultProvider,
    fallbackChain: ownerPolicy.fallbackEnabled ? rest : [],
    fallbackEnabled: ownerPolicy.fallbackEnabled,
    source: requestedProviderId != null ? "user-manual-invalid-fallback-to-auto" : "auto-default",
  };
}

/**
 * RADAR INTELLIGENCE V2.1 — Phase B — DB-facing validation.
 *
 * `IntelligenceProviderId` (types.ts) already includes documented FUTURE
 * placeholders ("gemini" / "deepseek" / "kimi" / "local") so adapters and
 * selection policy can be written once, ahead of any real integration —
 * but Phase B must NOT let OWNER-mutable, DB-persisted policy make one of
 * those placeholders configurable or dispatchable. `POLICY_CONFIGURABLE_
 * PROVIDER_IDS` is the deliberately narrower, Phase-B-specific allowlist:
 * exactly the providers with a real, registered adapter today. Every
 * validation path below checks against THIS set, never the full
 * `IntelligenceProviderId` union — so a stored/submitted "gemini" is
 * rejected exactly like any other unrecognized string, even though the
 * type system itself would accept it as a well-typed provider id.
 */
export const POLICY_CONFIGURABLE_PROVIDER_IDS = ["anthropic", "openai"] as const;
export type PolicyConfigurableProviderId = (typeof POLICY_CONFIGURABLE_PROVIDER_IDS)[number];

export function isPolicyConfigurableProviderId(value: unknown): value is PolicyConfigurableProviderId {
  return typeof value === "string" && (POLICY_CONFIGURABLE_PROVIDER_IDS as readonly string[]).includes(value);
}

export type ProviderPolicyValidationResult = { ok: true; policy: ProviderPolicy } | { ok: false; errors: readonly string[] };

/**
 * Strict, ALL-OR-NOTHING structural validation of a candidate policy
 * object against the full ProviderPolicy contract. Used by BOTH the
 * store's read path (candidate = a DB row, already field-mapped to this
 * shape — see provider-policy-store.ts) and the OWNER mutation's write
 * path (candidate = the caller's proposed update).
 *
 * FAIL-CLOSED, ALL-OR-NOTHING BY DESIGN (not per-field normalization):
 * if ANY field is malformed, the WHOLE candidate is rejected — this
 * function never returns a policy assembled from a mix of trusted
 * candidate fields and silently-substituted defaults. A "Frankenstein"
 * policy (some fields honored, others quietly replaced) is a policy the
 * OWNER never actually reviewed as a coherent whole, and is far harder to
 * reason about or audit than a clean binary "valid or not" outcome. This
 * mirrors the same allowlist-not-denylist, discard-the-whole-suspicious-
 * unit philosophy already used throughout this codebase (sanitize-
 * context.ts, observability.ts's field allowlist, stripAdminOnlyFields).
 *
 * Never mutates `candidate`; the returned policy's arrays are fresh,
 * frozen copies — never the same array reference as anything on
 * `candidate`, so a caller mutating their own input after the fact can
 * never retroactively alter a policy this function already returned.
 */
export function validateProviderPolicyCandidate(candidate: unknown): ProviderPolicyValidationResult {
  const errors: string[] = [];

  if (typeof candidate !== "object" || candidate === null || Array.isArray(candidate)) {
    return { ok: false, errors: ["policy must be a plain object"] };
  }
  const c = candidate as Record<string, unknown>;

  if (c.mode !== "AUTO" && c.mode !== "MANUAL") {
    errors.push("mode must be exactly 'AUTO' or 'MANUAL'");
  }

  const defaultProviderRaw = c.defaultProvider;
  if (defaultProviderRaw !== null && defaultProviderRaw !== undefined && !isPolicyConfigurableProviderId(defaultProviderRaw)) {
    errors.push("defaultProvider must be null or a policy-configurable provider id");
  }

  const fallbackOrderRaw = c.fallbackOrder;
  const enabledProvidersRaw = c.enabledProviders;
  const selectableProvidersRaw = c.userSelectableProviders;

  if (!Array.isArray(fallbackOrderRaw)) errors.push("fallbackOrder must be an array");
  if (!Array.isArray(enabledProvidersRaw)) errors.push("enabledProviders must be an array");
  if (!Array.isArray(selectableProvidersRaw)) errors.push("userSelectableProviders must be an array");

  if (typeof c.allowUserSelection !== "boolean") errors.push("allowUserSelection must be a boolean");
  if (typeof c.fallbackEnabled !== "boolean") errors.push("fallbackEnabled must be a boolean");

  // Stop here if the basic shape is already wrong — every check below
  // assumes the arrays/booleans above are genuinely present.
  if (errors.length > 0) return { ok: false, errors };

  const fallbackOrderArr = fallbackOrderRaw as unknown[];
  const enabledProvidersArr = enabledProvidersRaw as unknown[];
  const selectableProvidersArr = selectableProvidersRaw as unknown[];

  if (!fallbackOrderArr.every(isPolicyConfigurableProviderId)) errors.push("fallbackOrder contains an unrecognized/unsupported provider id");
  if (!enabledProvidersArr.every(isPolicyConfigurableProviderId)) errors.push("enabledProviders contains an unrecognized/unsupported provider id");
  if (!selectableProvidersArr.every(isPolicyConfigurableProviderId)) errors.push("userSelectableProviders contains an unrecognized/unsupported provider id");

  if (errors.length > 0) return { ok: false, errors };

  const fallbackOrder = fallbackOrderArr as PolicyConfigurableProviderId[];
  const enabledProviders = enabledProvidersArr as PolicyConfigurableProviderId[];
  const selectableProviders = selectableProvidersArr as PolicyConfigurableProviderId[];

  if (new Set(fallbackOrder).size !== fallbackOrder.length) errors.push("fallbackOrder must not contain duplicate provider ids");
  if (new Set(enabledProviders).size !== enabledProviders.length) errors.push("enabledProviders must not contain duplicate provider ids");
  if (new Set(selectableProviders).size !== selectableProviders.length) errors.push("userSelectableProviders must not contain duplicate provider ids");

  if (!selectableProviders.every((p) => enabledProviders.includes(p))) {
    errors.push("userSelectableProviders must be a subset of enabledProviders — a disabled provider can never be user-selectable");
  }

  // RADAR INTELLIGENCE V2.1 Phase D — allowUserSelection is the master
  // switch for exposing ANY selector to users at all; turning it on with
  // nothing to actually select would be a self-contradictory policy (a
  // "live" feature with zero options), so it is rejected outright rather
  // than silently tolerated — same fail-closed, all-or-nothing philosophy
  // as every other rule here.
  if (c.allowUserSelection === true && selectableProviders.length === 0) {
    errors.push("userSelectableProviders must contain at least one provider when allowUserSelection is true");
  }

  if (isPolicyConfigurableProviderId(defaultProviderRaw) && !enabledProviders.includes(defaultProviderRaw)) {
    errors.push("defaultProvider must be one of enabledProviders when set");
  }

  if (errors.length > 0) return { ok: false, errors };

  return {
    ok: true,
    policy: Object.freeze({
      mode: c.mode as ProviderMode,
      defaultProvider: isPolicyConfigurableProviderId(defaultProviderRaw) ? defaultProviderRaw : null,
      fallbackOrder: Object.freeze([...fallbackOrder]),
      enabledProviders: Object.freeze([...enabledProviders]),
      userSelectableProviders: Object.freeze([...selectableProviders]),
      allowUserSelection: c.allowUserSelection as boolean,
      fallbackEnabled: c.fallbackEnabled as boolean,
    }),
  };
}
