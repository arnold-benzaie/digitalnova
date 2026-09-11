import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 3 — the ONE server-side config boundary.
 * RADAR INTELLIGENCE V2 — extended to a SECOND provider (OpenAI), reading
 * an independent set of env vars with the exact same fail-closed rules.
 *
 * This is the ONLY module in lib/radar-intelligence/** that reads
 * process.env. Adapters, gateway, provider router, registry, request
 * builders, snapshot and UI never touch env directly.
 *
 * FAIL-CLOSED, per provider, independently:
 *  - `enabled` is true ONLY when the env flag is exactly "true" or "1".
 *  - `enabled` with NO api key -> effectiveEnabled = false (provider stays
 *    unavailable; the app never crashes because a key is missing).
 *  - unset env -> that provider disabled, RADAR deterministic, no
 *    external call. Anthropic being off never affects OpenAI's own flags
 *    and vice versa.
 *
 * The returned object carries each provider's `apiKey` (needed to build
 * its real transport) — it is `server-only`, must never be serialized to
 * a client, and the configured-registry factory consumes it and discards
 * it after constructing that provider's transport.
 *
 * A future provider (Gemini/DeepSeek/Kimi/Grok/local) adds one more
 * `RADAR_INTELLIGENCE_<ID>_{ENABLED,API_KEY,MODEL}` triplet and one more
 * `Loaded<Id>Config` block below — nothing else in this function changes.
 */
import {
  ANTHROPIC_API_KEY_ENV_VAR,
  ANTHROPIC_ENABLED_ENV_VAR,
  ANTHROPIC_ENABLED_TRUE_VALUES,
  ANTHROPIC_MODEL_ENV_VAR,
  DEFAULT_ANTHROPIC_CONFIG,
} from "./adapters/config";
import {
  OPENAI_API_KEY_ENV_VAR,
  OPENAI_ENABLED_ENV_VAR,
  OPENAI_ENABLED_TRUE_VALUES,
  OPENAI_MODEL_ENV_VAR,
  DEFAULT_OPENAI_CONFIG,
} from "./adapters/openai-config";

export type LoadedAnthropicConfig = {
  /** Raw flag: was the enable env var set to an accepted value? */
  enabledFlag: boolean;
  /** Is a non-empty credential present? */
  hasCredential: boolean;
  /** enabledFlag AND hasCredential — the only thing the registry acts on. */
  effectiveEnabled: boolean;
  model: string;
  /** null unless hasCredential. Never logged / serialized to a client. */
  apiKey: string | null;
  maxOutputTokens: number;
  maxRequestBytes: number;
};

/** Structurally identical to LoadedAnthropicConfig — kept as a separate
 * named type (not a shared generic) so each provider's shape can diverge
 * later without a breaking rename. */
export type LoadedOpenAiConfig = {
  enabledFlag: boolean;
  hasCredential: boolean;
  effectiveEnabled: boolean;
  model: string;
  apiKey: string | null;
  maxOutputTokens: number;
  maxRequestBytes: number;
};

export type LoadedRadarIntelligenceConfig = {
  anthropic: LoadedAnthropicConfig;
  openai: LoadedOpenAiConfig;
};

type EnvLike = Record<string, string | undefined>;

/**
 * @param env  injectable for tests — defaults to process.env, the only
 *             place this module (and the whole intelligence layer) reads it.
 */
export function loadRadarIntelligenceConfig(env: EnvLike = process.env): LoadedRadarIntelligenceConfig {
  const rawAnthropicEnabled = typeof env[ANTHROPIC_ENABLED_ENV_VAR] === "string" ? env[ANTHROPIC_ENABLED_ENV_VAR]!.trim() : "";
  const anthropicEnabledFlag = ANTHROPIC_ENABLED_TRUE_VALUES.includes(rawAnthropicEnabled);

  const rawAnthropicKey = typeof env[ANTHROPIC_API_KEY_ENV_VAR] === "string" ? env[ANTHROPIC_API_KEY_ENV_VAR]!.trim() : "";
  const anthropicHasCredential = rawAnthropicKey.length > 0;

  const rawAnthropicModel = typeof env[ANTHROPIC_MODEL_ENV_VAR] === "string" ? env[ANTHROPIC_MODEL_ENV_VAR]!.trim() : "";
  const anthropicModel = rawAnthropicModel.length > 0 ? rawAnthropicModel : DEFAULT_ANTHROPIC_CONFIG.model;

  const rawOpenAiEnabled = typeof env[OPENAI_ENABLED_ENV_VAR] === "string" ? env[OPENAI_ENABLED_ENV_VAR]!.trim() : "";
  const openAiEnabledFlag = OPENAI_ENABLED_TRUE_VALUES.includes(rawOpenAiEnabled);

  const rawOpenAiKey = typeof env[OPENAI_API_KEY_ENV_VAR] === "string" ? env[OPENAI_API_KEY_ENV_VAR]!.trim() : "";
  const openAiHasCredential = rawOpenAiKey.length > 0;

  const rawOpenAiModel = typeof env[OPENAI_MODEL_ENV_VAR] === "string" ? env[OPENAI_MODEL_ENV_VAR]!.trim() : "";
  const openAiModel = rawOpenAiModel.length > 0 ? rawOpenAiModel : DEFAULT_OPENAI_CONFIG.model;

  return {
    anthropic: {
      enabledFlag: anthropicEnabledFlag,
      hasCredential: anthropicHasCredential,
      effectiveEnabled: anthropicEnabledFlag && anthropicHasCredential,
      model: anthropicModel,
      apiKey: anthropicHasCredential ? rawAnthropicKey : null,
      maxOutputTokens: DEFAULT_ANTHROPIC_CONFIG.maxOutputTokens,
      maxRequestBytes: DEFAULT_ANTHROPIC_CONFIG.maxRequestBytes,
    },
    openai: {
      enabledFlag: openAiEnabledFlag,
      hasCredential: openAiHasCredential,
      effectiveEnabled: openAiEnabledFlag && openAiHasCredential,
      model: openAiModel,
      apiKey: openAiHasCredential ? rawOpenAiKey : null,
      maxOutputTokens: DEFAULT_OPENAI_CONFIG.maxOutputTokens,
      maxRequestBytes: DEFAULT_OPENAI_CONFIG.maxRequestBytes,
    },
  };
}

export {
  ANTHROPIC_API_KEY_ENV_VAR,
  ANTHROPIC_ENABLED_ENV_VAR,
  ANTHROPIC_MODEL_ENV_VAR,
  ANTHROPIC_ENABLED_TRUE_VALUES,
  OPENAI_API_KEY_ENV_VAR,
  OPENAI_ENABLED_ENV_VAR,
  OPENAI_MODEL_ENV_VAR,
  OPENAI_ENABLED_TRUE_VALUES,
};
