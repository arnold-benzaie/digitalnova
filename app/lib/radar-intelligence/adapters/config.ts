/**
 * RADAR INTELLIGENCE V1 — Slice 2 — Anthropic adapter configuration.
 *
 * SERVER-SIDE ONLY. This object decides whether the Anthropic adapter is
 * even constructed and registered. It is DISABLED BY DEFAULT: with the
 * default config the registry behaves exactly like Slice 1 (no external
 * provider, deterministic fallback only).
 *
 * NO SECRET LIVES HERE. The API credential is never part of this config,
 * never part of a request/context/telemetry/error, and never reaches the
 * browser. It is passed only into the eventual transport constructor
 * (see anthropic-transport.ts). The env-var NAME below is documentation —
 * nothing in Slice 2 reads it.
 */
/** Documentation only — no code in Slice 2 reads process.env for this. */
export const ANTHROPIC_API_KEY_ENV_VAR = "RADAR_INTELLIGENCE_ANTHROPIC_API_KEY" as const;

export type AnthropicAdapterConfig = {
  /** When false, the adapter is not registered at all. Default: false. */
  enabled: boolean;
  /** Model id — CONFIGURATION, not provider identity (the id stays "anthropic"). */
  model: string;
  /** Hard cap on the advisory summary length the provider may return. */
  maxOutputTokens: number;
  /** Optional soft ordering hint for the registry's fallback order. */
  fallbackPriority?: number;
};

export const DEFAULT_ANTHROPIC_CONFIG: AnthropicAdapterConfig = Object.freeze({
  enabled: false,
  model: "claude-sonnet-4-5",
  maxOutputTokens: 512,
});

/** The whole intelligence-layer server config. Extend per provider later. */
export type RadarIntelligenceConfig = {
  anthropic?: Partial<AnthropicAdapterConfig>;
};

export function resolveAnthropicConfig(overrides?: Partial<AnthropicAdapterConfig>): AnthropicAdapterConfig {
  const model = typeof overrides?.model === "string" && overrides.model.trim().length > 0 ? overrides.model.trim() : DEFAULT_ANTHROPIC_CONFIG.model;
  const maxOutputTokens =
    typeof overrides?.maxOutputTokens === "number" && Number.isFinite(overrides.maxOutputTokens) && overrides.maxOutputTokens > 0
      ? Math.min(4096, Math.trunc(overrides.maxOutputTokens))
      : DEFAULT_ANTHROPIC_CONFIG.maxOutputTokens;
  return Object.freeze({
    enabled: overrides?.enabled === true,
    model,
    maxOutputTokens,
    ...(typeof overrides?.fallbackPriority === "number" ? { fallbackPriority: Math.trunc(overrides.fallbackPriority) } : {}),
  });
}

/** The canonical provider id — never "claude" / "claude-api" / "anthropic-claude". */
export const ANTHROPIC_PROVIDER_ID = "anthropic" as const;
