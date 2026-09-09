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
/**
 * Env-var NAMES + accepted values. Only the server config loader
 * (lib/radar-intelligence/config-loader.ts) ever reads process.env — these
 * are exported for documentation and for that one loader.
 */
export const ANTHROPIC_API_KEY_ENV_VAR = "RADAR_INTELLIGENCE_ANTHROPIC_API_KEY" as const;
export const ANTHROPIC_ENABLED_ENV_VAR = "RADAR_INTELLIGENCE_ANTHROPIC_ENABLED" as const;
export const ANTHROPIC_MODEL_ENV_VAR = "RADAR_INTELLIGENCE_ANTHROPIC_MODEL" as const;
/** `enabled` flips true ONLY on one of these exact strings. Anything else
 * (unset, "", "yes", "on", "1 ", "TRUE"…) stays false — fail-closed. */
export const ANTHROPIC_ENABLED_TRUE_VALUES: readonly string[] = Object.freeze(["true", "1"]);

/** Cost-safety: at most ONE provider HTTP call per gateway invocation.
 * The adapter issues exactly one transport.generate() per run(); the
 * gateway's bounded retry is the only multiplier and it is capped by
 * policy.maxRetries (<= 3). No unbounded generation loop exists. */
export const MAX_REQUESTS_PER_INVOCATION = 1 as const;

/** Final defensive cap on the serialized request payload size, on top of
 * the sanitizer's per-field caps. Exceeding it -> INVALID_INTELLIGENCE_REQUEST. */
export const DEFAULT_MAX_REQUEST_BYTES = 24_000;

export type AnthropicAdapterConfig = {
  /** When false, the adapter is not registered at all. Default: false. */
  enabled: boolean;
  /** Model id — CONFIGURATION, not provider identity (the id stays "anthropic"). */
  model: string;
  /** Hard cap on the advisory summary length the provider may return. */
  maxOutputTokens: number;
  /** Final serialized-payload byte ceiling before an HTTP request. */
  maxRequestBytes: number;
  /** Optional soft ordering hint for the registry's fallback order. */
  fallbackPriority?: number;
};

export const DEFAULT_ANTHROPIC_CONFIG: AnthropicAdapterConfig = Object.freeze({
  enabled: false,
  model: "claude-sonnet-4-5",
  maxOutputTokens: 512,
  maxRequestBytes: DEFAULT_MAX_REQUEST_BYTES,
});

/** Byte size of the payload as it would be serialized for the wire. Pure. */
export function payloadByteSize(payload: { system: string; userMessage: string; model: string; maxOutputTokens: number }): number {
  const wire = JSON.stringify({
    model: payload.model,
    max_tokens: payload.maxOutputTokens,
    system: payload.system,
    messages: [{ role: "user", content: payload.userMessage }],
  });
  return typeof Buffer !== "undefined" ? Buffer.byteLength(wire, "utf8") : new TextEncoder().encode(wire).length;
}

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
  const maxRequestBytes =
    typeof overrides?.maxRequestBytes === "number" && Number.isFinite(overrides.maxRequestBytes) && overrides.maxRequestBytes > 0
      ? Math.min(64_000, Math.trunc(overrides.maxRequestBytes))
      : DEFAULT_ANTHROPIC_CONFIG.maxRequestBytes;
  return Object.freeze({
    enabled: overrides?.enabled === true,
    model,
    maxOutputTokens,
    maxRequestBytes,
    ...(typeof overrides?.fallbackPriority === "number" ? { fallbackPriority: Math.trunc(overrides.fallbackPriority) } : {}),
  });
}

/** The canonical provider id — never "claude" / "claude-api" / "anthropic-claude". */
export const ANTHROPIC_PROVIDER_ID = "anthropic" as const;
