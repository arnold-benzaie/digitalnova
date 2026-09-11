/**
 * RADAR INTELLIGENCE V2 — OpenAI adapter configuration.
 *
 * Mirrors adapters/config.ts exactly, for the second supported provider.
 * SERVER-SIDE ONLY. Decides whether the OpenAI adapter is even
 * constructed and registered. DISABLED BY DEFAULT.
 *
 * NO SECRET LIVES HERE. The API credential is never part of this config,
 * never part of a request/context/telemetry/error, and never reaches the
 * browser. It is passed only into the eventual transport constructor
 * (see openai-http-transport.ts). The env-var NAME below is documentation
 * — nothing here reads it; only config-loader.ts does.
 */
export const OPENAI_API_KEY_ENV_VAR = "RADAR_INTELLIGENCE_OPENAI_API_KEY" as const;
export const OPENAI_ENABLED_ENV_VAR = "RADAR_INTELLIGENCE_OPENAI_ENABLED" as const;
export const OPENAI_MODEL_ENV_VAR = "RADAR_INTELLIGENCE_OPENAI_MODEL" as const;
/** Same fail-closed convention as Anthropic's — flips true ONLY on one of
 * these exact strings. */
export const OPENAI_ENABLED_TRUE_VALUES: readonly string[] = Object.freeze(["true", "1"]);

export type OpenAiAdapterConfig = {
  /** When false, the adapter is not registered at all. Default: false. */
  enabled: boolean;
  /** Model id — CONFIGURATION, not provider identity (the id stays "openai"). */
  model: string;
  maxOutputTokens: number;
  maxRequestBytes: number;
  fallbackPriority?: number;
};

/** Reuses the SAME defensive request-size ceiling as Anthropic (24_000
 * bytes) — see adapters/config.ts::DEFAULT_MAX_REQUEST_BYTES. */
export const DEFAULT_OPENAI_MAX_REQUEST_BYTES = 24_000;

export const DEFAULT_OPENAI_CONFIG: OpenAiAdapterConfig = Object.freeze({
  enabled: false,
  model: "gpt-4o-mini",
  maxOutputTokens: 512,
  maxRequestBytes: DEFAULT_OPENAI_MAX_REQUEST_BYTES,
});

/** Byte size of the payload as it would be serialized for the wire. Pure. */
export function openAiPayloadByteSize(payload: { system: string; userMessage: string; model: string; maxOutputTokens: number }): number {
  const wire = JSON.stringify({
    model: payload.model,
    max_tokens: payload.maxOutputTokens,
    messages: [
      { role: "system", content: payload.system },
      { role: "user", content: payload.userMessage },
    ],
    response_format: { type: "json_object" },
  });
  return typeof Buffer !== "undefined" ? Buffer.byteLength(wire, "utf8") : new TextEncoder().encode(wire).length;
}

export function resolveOpenAiConfig(overrides?: Partial<OpenAiAdapterConfig>): OpenAiAdapterConfig {
  const model = typeof overrides?.model === "string" && overrides.model.trim().length > 0 ? overrides.model.trim() : DEFAULT_OPENAI_CONFIG.model;
  const maxOutputTokens =
    typeof overrides?.maxOutputTokens === "number" && Number.isFinite(overrides.maxOutputTokens) && overrides.maxOutputTokens > 0
      ? Math.min(4096, Math.trunc(overrides.maxOutputTokens))
      : DEFAULT_OPENAI_CONFIG.maxOutputTokens;
  const maxRequestBytes =
    typeof overrides?.maxRequestBytes === "number" && Number.isFinite(overrides.maxRequestBytes) && overrides.maxRequestBytes > 0
      ? Math.min(64_000, Math.trunc(overrides.maxRequestBytes))
      : DEFAULT_OPENAI_CONFIG.maxRequestBytes;
  return Object.freeze({
    enabled: overrides?.enabled === true,
    model,
    maxOutputTokens,
    maxRequestBytes,
    ...(typeof overrides?.fallbackPriority === "number" ? { fallbackPriority: Math.trunc(overrides.fallbackPriority) } : {}),
  });
}

/** The canonical provider id — never "gpt" / "chatgpt" / "openai-gpt". */
export const OPENAI_PROVIDER_ID = "openai" as const;
