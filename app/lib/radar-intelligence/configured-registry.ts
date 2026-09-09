import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 3 — build the provider registry from
 * server config. SERVER-ONLY.
 *
 * Flow:
 *   load server config
 *   -> anthropic effectiveEnabled (flag AND credential) ?
 *        yes -> construct the REAL HTTP transport with the key, register
 *               the anthropic adapter, then let the key fall out of scope
 *        no  -> register NO external provider (Slice-1 behaviour:
 *               providerUnavailable, source "radar-core")
 *
 * The api key never leaves this function: it is read from the loaded
 * config and passed ONLY into createAnthropicHttpTransport(). Nothing here
 * returns, logs, or persists it. No RADAR route calls this yet.
 */
import type { ProviderRegistry } from "./provider-registry";
import { createRadarIntelligenceRegistry } from "./adapters";
import { createAnthropicHttpTransport } from "./adapters/anthropic-http-transport";
import { loadRadarIntelligenceConfig, type LoadedRadarIntelligenceConfig } from "./config-loader";

export type ConfiguredRegistryDeps = {
  /** Injected for tests — defaults to reading process.env via the loader. */
  loadedConfig?: LoadedRadarIntelligenceConfig;
  /** Injected fake fetch for tests; real transport uses global fetch. */
  fetchImpl?: typeof fetch;
  clock?: () => Date;
  /** Test-only: override the request timeout passed to the HTTP transport. */
  requestTimeoutMs?: number;
};

export function createConfiguredRadarIntelligenceRegistry(deps: ConfiguredRegistryDeps = {}): ProviderRegistry {
  const config = deps.loadedConfig ?? loadRadarIntelligenceConfig();
  const a = config.anthropic;

  if (!a.effectiveEnabled || a.apiKey === null) {
    // Fail-closed: disabled, or enabled-but-no-key -> no external provider.
    return createRadarIntelligenceRegistry({});
  }

  const transport = createAnthropicHttpTransport({
    apiKey: a.apiKey,
    ...(deps.fetchImpl ? { fetchImpl: deps.fetchImpl } : {}),
    ...(typeof deps.requestTimeoutMs === "number" ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
  });
  // `a.apiKey` is not referenced again below — it goes out of scope here.

  return createRadarIntelligenceRegistry({
    config: {
      anthropic: {
        enabled: true,
        model: a.model,
        maxOutputTokens: a.maxOutputTokens,
        maxRequestBytes: a.maxRequestBytes,
      },
    },
    anthropicTransport: transport,
    ...(deps.clock ? { clock: deps.clock } : {}),
  });
}
