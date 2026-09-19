import "server-only";

/**
 * RADAR DISCOVERY ENGINE — Phase C-1 — build the real Google Places
 * provider from server config, mirroring
 * lib/radar-intelligence/configured-registry.ts's exact flow:
 *
 *   load server config
 *   -> effectiveEnabled (flag AND credential) ?
 *        yes -> construct the REAL HTTP transport with the key, then the
 *               provider, then let the key fall out of scope
 *        no  -> return null (mission section 9: absence of a key, or the
 *               flag being off, is NEVER itself a reason a call happens —
 *               there is structurally no provider object to call)
 *
 * The api key never leaves this function: read from the loaded config,
 * passed ONLY into createGooglePlacesHttpTransport()'s constructor.
 * Nothing here returns, logs, or persists it.
 */
import { loadRadarDiscoveryConfig, type LoadedRadarDiscoveryConfig } from "../config-loader";
import type { DiscoveryProvider } from "../provider";
// TYPE-ONLY — see google-places-provider.ts's own comment on why this
// module (rate-limit-gate.ts) must never be imported for a runtime value
// here: it transitively requires DATABASE_URL at module-load time. Erased
// entirely at compile time.
import type { DiscoveryRateLimitDecision } from "../rate-limit-gate";
import { createGooglePlacesHttpTransport } from "./google-places-http-transport";
import { createGooglePlacesProvider } from "./google-places-provider";
import type { ProviderBudgetGate } from "../budget/provider-budget-gate";

export type ConfiguredGooglePlacesDeps = {
  /** Injected for tests — defaults to reading process.env via the loader. */
  loadedConfig?: LoadedRadarDiscoveryConfig;
  fetchImpl?: typeof fetch;
  clock?: () => number;
  requestTimeoutMs?: number;
  /**
   * MISSION C-2D-0-FIX — overrides the provider-level rate-limit check.
   * Omitted (the real application's only current usage): the DB-backed
   * default is resolved lazily inside createGooglePlacesProvider()'s own
   * search() — production behavior is unchanged. Supplied (e.g. the
   * guarded live-smoke script, via
   * lib/radar-discovery/in-memory-rate-limit.ts): the DB-backed default is
   * NEVER imported, so this whole call graph never requires DATABASE_URL.
   * This is a real, functioning rate-limit check either way — never a
   * bypass (see in-memory-rate-limit.ts's own header for why an in-memory
   * guard is the architecturally correct choice for a one-shot caller).
   */
  checkRateLimit?: (providerId: string) => Promise<DiscoveryRateLimitDecision>;
  /** MISSION C-2D-4-E — same override discipline as `checkRateLimit`
   * above, for the SEPARATE enrichment scope (rate-limit-gate.ts's own
   * checkDiscoveryEnrichmentProviderRateLimit()). Omitted in real
   * application use — the DB-backed default resolves lazily inside
   * google-places-provider.ts's own getDetails(). */
  checkEnrichmentRateLimit?: (providerId: string) => Promise<DiscoveryRateLimitDecision>;
  /** MISSION C-2D-6-B — RADAR DISCOVERY COST & QUOTA GOVERNANCE. Pure
   * pass-through, no default resolution here (unlike the two rate-limit
   * deps above) — this factory has no actor identity to attribute a
   * reservation to; only the calling Server Action does. Omitted: no
   * budget gating for this provider instance (see
   * google-places-provider.ts's own CreateGooglePlacesProviderDeps
   * docstring). Supplied (the real Server Actions,
   * budget/provider-budget-gate.ts::createProviderBudgetGate()): every
   * real HTTP attempt is reserved/settled. */
  checkSearchBudget?: ProviderBudgetGate;
  checkEnrichmentBudget?: ProviderBudgetGate;
};

/**
 * Returns a real, network-capable DiscoveryProvider, or `null` when the
 * provider is not configured (flag off, or no credential) — never a
 * provider object that would attempt a call anyway.
 */
export function createConfiguredGooglePlacesProvider(deps: ConfiguredGooglePlacesDeps = {}): DiscoveryProvider | null {
  const config = deps.loadedConfig ?? loadRadarDiscoveryConfig();
  const g = config.googlePlaces;

  if (!g?.effectiveEnabled || g.apiKey === null) {
    return null;
  }

  const transport = createGooglePlacesHttpTransport({
    apiKey: g.apiKey,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(typeof deps.requestTimeoutMs === "number" ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
  });
  // `g.apiKey` is not referenced again below — it goes out of scope here.

  return createGooglePlacesProvider({
    transport,
    ...(deps.clock ? { clock: deps.clock } : {}),
    ...(deps.checkRateLimit ? { checkRateLimit: deps.checkRateLimit } : {}),
    ...(deps.checkEnrichmentRateLimit ? { checkEnrichmentRateLimit: deps.checkEnrichmentRateLimit } : {}),
    ...(deps.checkSearchBudget ? { checkSearchBudget: deps.checkSearchBudget } : {}),
    ...(deps.checkEnrichmentBudget ? { checkEnrichmentBudget: deps.checkEnrichmentBudget } : {}),
  });
}
