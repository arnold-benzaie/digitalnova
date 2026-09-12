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
import { isKnownModelId } from "./model-catalog";
import type { ProviderRegistry } from "./provider-registry";
import type { PolicyConfigurableProviderId } from "./provider-policy";

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
  /**
   * RADAR INTELLIGENCE V2.1 — Phase E — an already-loaded, per-provider
   * model override (see provider-runtime-config-store.ts), plain data —
   * never a DB read performed by THIS function. The real caller
   * (lib/actions/radar-intelligence.ts) loads it async, once, before
   * building the synchronous `createRegistry` closure this factory lives
   * behind; tests may inject any fixture directly.
   *
   * Re-validated AGAIN here via `isKnownModelId()` regardless of whether
   * the caller already validated it (defense in depth, same convention as
   * `isPolicyConfigurableProviderId` being re-checked at multiple seams
   * elsewhere in this feature): an override missing, or naming a model
   * outside that provider's own catalog, is silently ignored and that
   * provider's env-configured model (`a.model` / `o.model`) is used
   * instead — never a throw, never a fabricated model id reaching a
   * transport.
   */
  modelOverrides?: Partial<Record<PolicyConfigurableProviderId, string>>;
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
    // Phase E: a validated OWNER model override takes precedence over the
    // env-configured model; anything unvalidated/unknown falls back to
    // `a.model` unchanged (see ConfiguredRegistryDeps.modelOverrides).
    const anthropicOverride = deps.modelOverrides?.anthropic;
    const anthropicModel = typeof anthropicOverride === "string" && isKnownModelId("anthropic", anthropicOverride) ? anthropicOverride : a.model;
    registryOptions.config = {
      ...registryOptions.config,
      anthropic: { enabled: true, model: anthropicModel, maxOutputTokens: a.maxOutputTokens, maxRequestBytes: a.maxRequestBytes },
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
    const openaiOverride = deps.modelOverrides?.openai;
    const openaiModel = typeof openaiOverride === "string" && isKnownModelId("openai", openaiOverride) ? openaiOverride : o.model;
    registryOptions.config = {
      ...registryOptions.config,
      openai: { enabled: true, model: openaiModel, maxOutputTokens: o.maxOutputTokens, maxRequestBytes: o.maxRequestBytes },
    };
    registryOptions.openaiTransport = openaiTransport;
  }

  return createRadarIntelligenceRegistry(registryOptions);
}
