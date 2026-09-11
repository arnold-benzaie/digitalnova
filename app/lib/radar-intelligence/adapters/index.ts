/**
 * RADAR INTELLIGENCE V1 — Slice 2 — adapter layer surface + the
 * explicitly-configured registry factory.
 * RADAR INTELLIGENCE V2 — extended to a SECOND provider (OpenAI),
 * additively: every existing call site that only ever set
 * `options.config.anthropic` / `options.anthropicTransport` keeps working
 * unchanged (the new `openai` fields are independently optional).
 *
 * `createRadarIntelligenceRegistry(config)` is the ONE place an external
 * provider becomes available. With no config (or a given provider's
 * `enabled` not true) that provider is simply not registered — the
 * registry then behaves identically to Slice 1's default for it:
 * `providerUnavailable: true` / `source: "radar-core"` / `advisory: null`
 * once no capable provider remains. Each provider is gated INDEPENDENTLY
 * — Anthropic being off never prevents OpenAI from registering, and vice
 * versa (see docs/radar-intelligence-multi-provider-architecture.md).
 *
 * Future providers (Gemini/DeepSeek/Kimi/Grok/local) plug in the SAME
 * way: one more `options.config.<id>` + `options.<id>Transport` pair and
 * one more `if (config.enabled) registry.register(createXAdapter(...))`
 * block — nothing else in this file, the gateway, the provider router,
 * advisory-core, or the UI needs to change.
 */
import { createProviderRegistry, type ProviderRegistry } from "../provider-registry";
import { deterministicFallbackAdapter } from "../deterministic-fallback";
import { createAnthropicAdapter, type AnthropicAdapterDeps } from "./anthropic";
import { resolveAnthropicConfig, type RadarIntelligenceConfig } from "./config";
import type { AnthropicTransport } from "./anthropic-transport";
import { createOpenAiAdapter, type OpenAiAdapterDeps } from "./openai";
import { resolveOpenAiConfig } from "./openai-config";
import type { OpenAiTransport } from "./openai-transport";

export * from "./config";
export * from "./anthropic-transport";
export * from "./anthropic-request-builder";
export * from "./anthropic-response";
export * from "./anthropic";
export * from "./openai-config";
export * from "./openai-transport";
export * from "./openai-request-builder";
export * from "./openai-response";
export * from "./openai";

export type CreateRegistryOptions = {
  config?: RadarIntelligenceConfig;
  /** Injected transport (real in prod, fake in tests). Only consulted when
   * anthropic is enabled. */
  anthropicTransport?: AnthropicTransport;
  /** Injected transport (real in prod, fake in tests). Only consulted when
   * openai is enabled. */
  openaiTransport?: OpenAiTransport;
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

  const openaiConfig = resolveOpenAiConfig(options.config?.openai);
  if (openaiConfig.enabled) {
    const deps: OpenAiAdapterDeps = {
      config: options.config?.openai,
      ...(options.openaiTransport ? { transport: options.openaiTransport } : {}),
      ...(options.clock ? { clock: options.clock } : {}),
    };
    registry.register(createOpenAiAdapter(deps));
  }

  return registry;
}
