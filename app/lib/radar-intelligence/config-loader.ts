import "server-only";

/**
 * RADAR INTELLIGENCE V1 — Slice 3 — the ONE server-side config boundary.
 *
 * This is the ONLY module in lib/radar-intelligence/** that reads
 * process.env. Adapters, gateway, registry, request builder, snapshot and
 * UI never touch env directly.
 *
 * FAIL-CLOSED:
 *  - `enabled` is true ONLY when the env flag is exactly "true" or "1".
 *  - `enabled` with NO api key -> effectiveEnabled = false (provider stays
 *    unavailable; the app never crashes because a key is missing).
 *  - unset env -> Anthropic disabled, RADAR deterministic, no external call.
 *
 * The returned object carries `apiKey` (needed to build the real transport)
 * — it is `server-only`, must never be serialized to a client, and the
 * configured-registry factory consumes it and discards it after
 * constructing the transport.
 */
import {
  ANTHROPIC_API_KEY_ENV_VAR,
  ANTHROPIC_ENABLED_ENV_VAR,
  ANTHROPIC_ENABLED_TRUE_VALUES,
  ANTHROPIC_MODEL_ENV_VAR,
  DEFAULT_ANTHROPIC_CONFIG,
} from "./adapters/config";

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

export type LoadedRadarIntelligenceConfig = {
  anthropic: LoadedAnthropicConfig;
};

type EnvLike = Record<string, string | undefined>;

/**
 * @param env  injectable for tests — defaults to process.env, the only
 *             place this module (and the whole intelligence layer) reads it.
 */
export function loadRadarIntelligenceConfig(env: EnvLike = process.env): LoadedRadarIntelligenceConfig {
  const rawEnabled = typeof env[ANTHROPIC_ENABLED_ENV_VAR] === "string" ? env[ANTHROPIC_ENABLED_ENV_VAR]!.trim() : "";
  const enabledFlag = ANTHROPIC_ENABLED_TRUE_VALUES.includes(rawEnabled);

  const rawKey = typeof env[ANTHROPIC_API_KEY_ENV_VAR] === "string" ? env[ANTHROPIC_API_KEY_ENV_VAR]!.trim() : "";
  const hasCredential = rawKey.length > 0;

  const rawModel = typeof env[ANTHROPIC_MODEL_ENV_VAR] === "string" ? env[ANTHROPIC_MODEL_ENV_VAR]!.trim() : "";
  const model = rawModel.length > 0 ? rawModel : DEFAULT_ANTHROPIC_CONFIG.model;

  return {
    anthropic: {
      enabledFlag,
      hasCredential,
      effectiveEnabled: enabledFlag && hasCredential,
      model,
      apiKey: hasCredential ? rawKey : null,
      maxOutputTokens: DEFAULT_ANTHROPIC_CONFIG.maxOutputTokens,
      maxRequestBytes: DEFAULT_ANTHROPIC_CONFIG.maxRequestBytes,
    },
  };
}

export { ANTHROPIC_API_KEY_ENV_VAR, ANTHROPIC_ENABLED_ENV_VAR, ANTHROPIC_MODEL_ENV_VAR, ANTHROPIC_ENABLED_TRUE_VALUES };
