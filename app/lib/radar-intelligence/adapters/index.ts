/**
 * RADAR INTELLIGENCE V1 — Slice 2 — adapter layer surface + the
 * explicitly-configured registry factory.
 *
 * `createRadarIntelligenceRegistry(config)` is the ONE place an external
 * provider becomes available. With no config (or `anthropic.enabled` not
 * true) it returns a registry identical to Slice 1's default: only the
 * deterministic fallback, so `providerUnavailable: true` /
 * `source: "radar-core"` / `advisory: null`.
 */
import { createProviderRegistry, type ProviderRegistry } from "../provider-registry";
import { deterministicFallbackAdapter } from "../deterministic-fallback";
import { createAnthropicAdapter, type AnthropicAdapterDeps } from "./anthropic";
import { resolveAnthropicConfig, type RadarIntelligenceConfig } from "./config";
import type { AnthropicTransport } from "./anthropic-transport";

export * from "./config";
export * from "./anthropic-transport";
export * from "./anthropic-request-builder";
export * from "./anthropic-response";
export * from "./anthropic";

export type CreateRegistryOptions = {
  config?: RadarIntelligenceConfig;
  /** Injected transport (real in prod, fake in tests). Only consulted when
   * anthropic is enabled. */
  anthropicTransport?: AnthropicTransport;
  /** Injected clock for the adapters. */
  clock?: () => Date;
};

export function createRadarIntelligenceRegistry(options: CreateRegistryOptions = {}): ProviderRegistry {
  const registry = createProviderRegistry();
  registry.register(deterministicFallbackAdapter);

  const anthropicConfig = resolveAnthropicConfig(options.config?.anthropic);
  if (anthropicConfig.enabled) {
    const deps: AnthropicAdapterDeps = {
      config: options.config?.anthropic,
      ...(options.anthropicTransport ? { transport: options.anthropicTransport } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
    };
    registry.register(createAnthropicAdapter(deps));
  }

  return registry;
}
