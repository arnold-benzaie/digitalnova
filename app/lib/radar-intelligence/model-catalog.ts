/**
 * RADAR INTELLIGENCE V2.1 — Phase E — provider model catalog.
 *
 * The ONE static, server-authoritative allowlist of model ids RADAR
 * Intelligence is allowed to route to, per provider. No secret, no env
 * value, no live provider lookup — a plain, hand-maintained table.
 * Adding a real new model means adding one entry here; it never means a
 * client (or a stored DB row) can manufacture an arbitrary model id.
 *
 * Every id below is one this codebase has already referenced as a real,
 * currently-relevant RADAR Intelligence model — the Anthropic adapter's
 * own default (config.ts / docs/radar-intelligence-production-config.md)
 * and its documented successor, and the OpenAI adapter's own default plus
 * the exact model id Production's own safe diagnostics already proved is
 * live (see the "fix(radar): use gpt5 completion token parameter" commit
 * and openai-http-transport.ts's isGpt5FamilyModel). Nothing here is
 * invented, and no Gemini/DeepSeek/Kimi/Grok/local id belongs in this file
 * — those providers are not policy-configurable (provider-policy.ts) and
 * must not gain a model catalog before they gain anything else.
 *
 * `status` is a plain display hint, never a live deprecation feed: an
 * entry only ever becomes "deprecated" by a deliberate edit to this file
 * when this codebase's own configuration intentionally knows a model is
 * being phased out, never inferred from a provider response.
 */
import type { PolicyConfigurableProviderId } from "./provider-policy";

export type ProviderModelStatus = "active" | "deprecated";

export type ProviderModelDefinition = {
  providerId: PolicyConfigurableProviderId;
  id: string;
  label: string;
  status: ProviderModelStatus;
};

const ANTHROPIC_MODELS: readonly ProviderModelDefinition[] = Object.freeze([
  Object.freeze({ providerId: "anthropic", id: "claude-sonnet-4-5", label: "Claude Sonnet 4.5", status: "active" }),
  Object.freeze({ providerId: "anthropic", id: "claude-sonnet-5", label: "Claude Sonnet 5", status: "active" }),
]);

const OPENAI_MODELS: readonly ProviderModelDefinition[] = Object.freeze([
  Object.freeze({ providerId: "openai", id: "gpt-4o-mini", label: "GPT-4o mini", status: "active" }),
  Object.freeze({ providerId: "openai", id: "gpt-5.6-terra", label: "GPT-5.6 Terra", status: "active" }),
]);

/** Keyed exactly by PolicyConfigurableProviderId — no gemini/deepseek/kimi/local key can exist. */
export const PROVIDER_MODEL_CATALOG: Readonly<Record<PolicyConfigurableProviderId, readonly ProviderModelDefinition[]>> = Object.freeze({
  anthropic: ANTHROPIC_MODELS,
  openai: OPENAI_MODELS,
});

/** The full catalog, flattened — for a UI that wants one list. */
export function listAllProviderModels(): readonly ProviderModelDefinition[] {
  return [...PROVIDER_MODEL_CATALOG.anthropic, ...PROVIDER_MODEL_CATALOG.openai];
}

export function listModelsFor(providerId: PolicyConfigurableProviderId): readonly ProviderModelDefinition[] {
  return PROVIDER_MODEL_CATALOG[providerId] ?? [];
}

/**
 * Server-authoritative validation: true only for a `modelId` that is a
 * non-empty string AND appears in `providerId`'s own catalog above.
 * Never true for a model belonging to the OTHER provider (provider/model
 * mismatch), never true for an unknown/forged id, never a fuzzy/prefix
 * match.
 */
export function isKnownModelId(providerId: PolicyConfigurableProviderId, modelId: unknown): modelId is string {
  if (typeof modelId !== "string" || modelId.trim().length === 0) return false;
  return listModelsFor(providerId).some((m) => m.id === modelId);
}
