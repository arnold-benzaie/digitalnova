import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 3 — internal, server-only provider status.
 * RADAR INTELLIGENCE V2 — extended with an OPTIONAL `configured` field per
 * known provider (mission section 19), and with synthetic entries for a
 * known provider that never made it into the registry at all (disabled, or
 * enabled but missing its credential) — today those are simply invisible
 * (createConfiguredRadarIntelligenceRegistry only registers a provider once
 * it is BOTH enabled AND has a key), which makes "off" indistinguishable
 * from "misconfigured" for an operator. `configured` answers a narrower
 * question than `enabled`: "does this provider have a non-empty credential
 * at all", independent of whether the flag is currently on.
 *
 * Operational visibility for administrators. Gated by
 * requireStaffMember("SYSTEM_ADMIN") — the existing permission for
 * integrations / security config (OWNER + ADMIN today). EMPLOYEE and
 * MANAGER do not have it. No new RBAC permission; permissions.ts unchanged.
 *
 * Returns ONLY safe fields: provider id, connection, health, enabled,
 * capabilities, and (real-config path only) configured. NEVER an api key,
 * model-secret metadata, request headers, a raw provider body, or any env
 * contents. No live health ping, no credential test call — `configured` is
 * computed ONLY from whether loadRadarIntelligenceConfig() saw a non-empty
 * env value, never by contacting the provider.
 *
 * `configured` is populated ONLY when this call resolves its OWN registry
 * from real server config (i.e. the caller did not inject a `registry`
 * directly) — a hand-built/fake registry carries no associated env config,
 * so attaching `configured` to it would be a guess, not a fact. Every
 * existing caller that injects `registry` (all pre-V2 tests) keeps getting
 * back the exact same fields as before, unchanged.
 *
 * Not wired into any UI. There is no AI settings page / provider selector /
 * "connected" badge in this slice.
 */
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import type { ProviderRegistry } from "./provider-registry";
import { createConfiguredRadarIntelligenceRegistry, type ConfiguredRegistryDeps } from "./configured-registry";
import { loadRadarIntelligenceConfig, type LoadedRadarIntelligenceConfig } from "./config-loader";

export type RadarIntelligenceProviderStatus = {
  provider: string;
  connection: "DISCONNECTED" | "CONNECTED" | "DEGRADED" | "DISABLED";
  health: "HEALTHY" | "UNHEALTHY";
  enabled: boolean;
  capabilities: string[];
  /** Whether a non-empty credential is configured for this provider,
   * independent of the enabled flag. Only present on the real-config path
   * (see module docstring) — absent entirely for an injected/fake registry. */
  configured?: boolean;
};

export type RadarIntelligenceStatusView = {
  providers: RadarIntelligenceProviderStatus[];
};

export type GetProviderStatusDeps = {
  /** Test seam — inject a pre-built registry, or config/fetch for the
   * configured factory. */
  registry?: ProviderRegistry;
  configuredRegistryDeps?: ConfiguredRegistryDeps;
};

/** The complete set of known, addressable provider ids this status view
 * knows about — kept in sync with the registered adapters in
 * adapters/index.ts. A future provider adds one entry here (and nowhere
 * else in this file). */
const KNOWN_PROVIDER_IDS = ["anthropic", "openai"] as const;

function configuredFlagFor(loadedConfig: LoadedRadarIntelligenceConfig, id: (typeof KNOWN_PROVIDER_IDS)[number]): boolean {
  const providerConfig = loadedConfig[id];
  return providerConfig?.apiKey !== null && providerConfig?.apiKey !== undefined;
}

export async function getRadarIntelligenceProviderStatus(deps: GetProviderStatusDeps = {}): Promise<RadarIntelligenceStatusView> {
  await requireStaffMember("SYSTEM_ADMIN");

  // Only the real-config path (no directly-injected registry) has an
  // associated env config to compute `configured` from — and it reuses
  // the EXACT SAME loadedConfig (including any test-injected
  // configuredRegistryDeps.loadedConfig) the registry itself was built
  // from, so the two never disagree.
  const usingRealConfig = deps.registry === undefined;
  const registry = deps.registry ?? createConfiguredRadarIntelligenceRegistry(deps.configuredRegistryDeps ?? {});
  const loadedConfig = usingRealConfig ? (deps.configuredRegistryDeps?.loadedConfig ?? loadRadarIntelligenceConfig()) : undefined;

  const providers: RadarIntelligenceProviderStatus[] = registry.list().map((adapter) => {
    const h = adapter.health();
    const base: RadarIntelligenceProviderStatus = {
      provider: adapter.id,
      connection: h.connection,
      health: h.health,
      enabled: adapter.disabled !== true,
      capabilities: [...h.capabilities],
    };
    if (loadedConfig && (KNOWN_PROVIDER_IDS as readonly string[]).includes(adapter.id)) {
      return { ...base, configured: configuredFlagFor(loadedConfig, adapter.id as (typeof KNOWN_PROVIDER_IDS)[number]) };
    }
    return base;
  });

  // A known provider that never made it into the registry at all (config
  // flag off, or on but missing its key) is otherwise invisible — add a
  // pure-configuration synthetic entry for it, never touching a live
  // adapter/transport/health check. Mirrors exactly the shape a real
  // disabled adapter's own health() already reports (connection
  // "DISABLED", health "HEALTHY", capabilities []).
  if (loadedConfig) {
    const seen = new Set(providers.map((p) => p.provider));
    for (const id of KNOWN_PROVIDER_IDS) {
      if (seen.has(id)) continue;
      providers.push({
        provider: id,
        connection: "DISABLED",
        health: "HEALTHY",
        enabled: loadedConfig[id]?.effectiveEnabled === true,
        capabilities: [],
        configured: configuredFlagFor(loadedConfig, id),
      });
    }
  }

  return { providers };
}
