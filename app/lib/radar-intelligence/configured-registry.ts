import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 3 — build the provider registry from
 * server config. SERVER-ONLY.
 * RADAR INTELLIGENCE V2 — extended to register BOTH supported providers
 * (Anthropic, OpenAI) INDEPENDENTLY — one provider being disabled or
 * unconfigured never affects the other.
 *
 * Flow, per provider:
 *   load server config
 *   -> that provider's effectiveEnabled (flag AND credential) ?
 *        yes -> construct its REAL HTTP transport with the key, register
 *               its adapter, then let the key fall out of scope
 *        no  -> that provider is simply not registered (Slice-1
 *               behaviour for it: providerUnavailable if it ends up being
 *               the only capable candidate, source "radar-core")
 *
 * Each api key never leaves this function: it is read from the loaded
 * config and passed ONLY into that provider's own HTTP-transport
 * constructor. Nothing here returns, logs, or persists it.
 *
 * A future provider (Gemini/DeepSeek/Kimi/Grok/local) adds one more
 * `if (p?.effectiveEnabled && p.apiKey !== null) { ... }` block following
 * the exact same shape — nothing else here changes. See
 * docs/radar-intelligence-multi-provider-architecture.md.
 */
import { createRadarIntelligenceRegistry, type CreateRegistryOptions } from "./adapters";
import { createAnthropicHttpTransport } from "./adapters/anthropic-http-transport";
import { createOpenAiHttpTransport } from "./adapters/openai-http-transport";
import { loadRadarIntelligenceConfig, type LoadedRadarIntelligenceConfig } from "./config-loader";
import type { ProviderRegistry } from "./provider-registry";

export type ConfiguredRegistryDeps = {
  /** Injected for tests — defaults to reading process.env via the loader. */
  loadedConfig?: LoadedRadarIntelligenceConfig;
  /** Shared fallback fake fetch, applied to whichever provider transport
   * has no provider-specific override below. Kept for backward
   * compatibility with single-provider tests written before OpenAI
   * existed. */
  fetchImpl?: typeof fetch;
  /** Provider-specific fake-fetch overrides — needed to exercise both
   * providers independently (e.g. Anthropic fails, OpenAI succeeds) in
   * one configured registry. Take precedence over `fetchImpl`. */
  anthropicFetchImpl?: typeof fetch;
  openaiFetchImpl?: typeof fetch;
  clock?: () => Date;
  /** Test-only: override the request timeout passed to every HTTP transport. */
  requestTimeoutMs?: number;
};

export function createConfiguredRadarIntelligenceRegistry(deps: ConfiguredRegistryDeps = {}): ProviderRegistry {
  const config = deps.loadedConfig ?? loadRadarIntelligenceConfig();
  // Optional-chained deliberately: a hand-built test fixture predating
  // this provider may omit `openai` entirely — that must mean "not
  // configured", never a crash.
  const a = config.anthropic;
  const o = config.openai;

  const registryOptions: CreateRegistryOptions = {
    config: {},
    ...(deps.clock ? { clock: deps.clock } : {}),
  };

  if (a?.effectiveEnabled && a.apiKey !== null) {
    const anthropicFetch = deps.anthropicFetchImpl ?? deps.fetchImpl;
    const anthropicTransport = createAnthropicHttpTransport({
      apiKey: a.apiKey,
      ...(anthropicFetch ? { fetchImpl: anthropicFetch } : {}),
      ...(typeof deps.requestTimeoutMs === "number" ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
    });
    // `a.apiKey` is not referenced again below — it goes out of scope here.
    registryOptions.config = {
      ...registryOptions.config,
      anthropic: { enabled: true, model: a.model, maxOutputTokens: a.maxOutputTokens, maxRequestBytes: a.maxRequestBytes },
    };
    registryOptions.anthropicTransport = anthropicTransport;
  }

  if (o?.effectiveEnabled && o.apiKey !== null) {
    const openaiFetch = deps.openaiFetchImpl ?? deps.fetchImpl;
    const openaiTransport = createOpenAiHttpTransport({
      apiKey: o.apiKey,
      ...(openaiFetch ? { fetchImpl: openaiFetch } : {}),
      ...(typeof deps.requestTimeoutMs === "number" ? { requestTimeoutMs: deps.requestTimeoutMs } : {}),
    });
    // `o.apiKey` is not referenced again below — it goes out of scope here.
    registryOptions.config = {
      ...registryOptions.config,
      openai: { enabled: true, model: o.model, maxOutputTokens: o.maxOutputTokens, maxRequestBytes: o.maxRequestBytes },
    };
    registryOptions.openaiTransport = openaiTransport;
  }

  return createRadarIntelligenceRegistry(registryOptions);
}
