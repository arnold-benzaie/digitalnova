import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 3 — internal, server-only provider status.
 *
 * Operational visibility for administrators. Gated by
 * requireStaffMember("SYSTEM_ADMIN") — the existing permission for
 * integrations / security config (OWNER + ADMIN today). EMPLOYEE and
 * MANAGER do not have it. No new RBAC permission; permissions.ts unchanged.
 *
 * Returns ONLY safe fields: provider id, connection, health, enabled,
 * capabilities. NEVER an api key, model-secret metadata, request headers,
 * a raw provider body, or any env contents. No live health ping — the
 * status is derived from each adapter's synthetic health().
 *
 * Not wired into any UI. There is no AI settings page / provider selector /
 * "connected" badge in this slice.
 */
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import type { ProviderRegistry } from "./provider-registry";
import { createConfiguredRadarIntelligenceRegistry, type ConfiguredRegistryDeps } from "./configured-registry";

export type RadarIntelligenceProviderStatus = {
  provider: string;
  connection: "DISCONNECTED" | "CONNECTED" | "DEGRADED" | "DISABLED";
  health: "HEALTHY" | "UNHEALTHY";
  enabled: boolean;
  capabilities: string[];
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

export async function getRadarIntelligenceProviderStatus(deps: GetProviderStatusDeps = {}): Promise<RadarIntelligenceStatusView> {
  await requireStaffMember("SYSTEM_ADMIN");

  const registry = deps.registry ?? createConfiguredRadarIntelligenceRegistry(deps.configuredRegistryDeps ?? {});

  const providers: RadarIntelligenceProviderStatus[] = registry.list().map((adapter) => {
    const h = adapter.health();
    return {
      provider: adapter.id,
      connection: h.connection,
      health: h.health,
      enabled: adapter.disabled !== true,
      capabilities: [...h.capabilities],
    };
  });

  return { providers };
}
