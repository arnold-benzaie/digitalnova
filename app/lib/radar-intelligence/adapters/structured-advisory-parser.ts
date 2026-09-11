/**
 * RADAR INTELLIGENCE V2 — provider-agnostic structured-advisory parsing.
 *
 * The ONE place the {summary, risks, nextAction, reasoning} JSON contract,
 * its safe-field length/count caps, its UUID redaction, and its
 * graceful-degradation-to-plain-text rule are implemented. Every
 * provider's response normalizer (anthropic-response.ts, openai-response.ts,
 * and any future provider) delegates here instead of re-implementing this
 * logic — adding a new provider never means re-deriving these rules.
 *
 * Pure, no I/O, no provider identity, no secrets. Provider output is
 * UNTRUSTED — this module validates shape, drops unknown fields, and
 * truncates oversized ones. It never treats model text as a URL, command,
 * assignment, HTML, SQL, or server-action call — everything it produces is
 * DISPLAY DATA only.
 */
import { redactUuids } from "../sanitize-context";

export const MAX_SUMMARY_LEN = 1_200;
export const MAX_NEXT_ACTION_LEN = 160;
export const MAX_TAGS = 8;
export const MAX_TAG_LEN = 40;
export const MAX_WARNINGS = 6;
export const MAX_WARNING_LEN = 200;
export const MAX_RISKS = 6;
export const MAX_RISK_LEN = 120;
export const MAX_REASONING_LEN = 400;

export function cleanText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = redactUuids(value).trim().slice(0, maxLen);
  return t.length > 0 ? t : undefined;
}

export function cleanStringArray(value: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const t = cleanText(item, maxLen);
    if (t) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

/** Strip a ```json ... ``` (or bare ``` ... ```) fence around `text`, if
 * the model wrapped its JSON in one despite being asked not to. */
export function stripJsonFence(text: string): string {
  const trimmed = text.trim();
  const fenced = /^```(?:json)?\s*([\s\S]*?)\s*```$/i.exec(trimmed);
  return fenced ? fenced[1].trim() : trimmed;
}

/**
 * Best-effort parse of the model's own text as the requested
 * { summary, risks, nextAction, reasoning } JSON object. Returns
 * undefined on ANY failure (not valid JSON, or not a plain object) —
 * the caller degrades to plain-text summary in that case. Never throws.
 */
export function tryParseStructuredText(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stripJsonFence(text));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Given the model's own free-text reply (already extracted from whichever
 * provider-specific response envelope), resolve the raw fields bag: parse
 * it as the requested structured JSON; on ANY failure, degrade to a plain
 * summary. Never throws — this IS the graceful-degradation rule, shared
 * by every provider.
 */
export function resolveStructuredFields(modelText: string): Record<string, unknown> {
  return tryParseStructuredText(modelText) ?? { summary: modelText };
}

export type CleanedAdvisoryFields = {
  summary: string;
  suggestedNextAction?: string;
  risks?: string[];
  reasoning?: string;
  tags?: string[];
  warnings?: string[];
};

/**
 * Cleans a raw `fields` bag (either the tolerant top-level shape a fake/
 * future provider may return directly, or the parsed/degraded model-text
 * shape from resolveStructuredFields) into the safe advisory piece.
 * Accepts EITHER "nextAction" (the wire key every provider's system
 * instruction asks for) or "suggestedNextAction" (older fakes/tests).
 * Returns undefined ONLY when no usable summary exists at all — the
 * caller maps that to a safe PROVIDER_ERROR/PROVIDER_PARSE.
 *
 * Deliberately does NOT touch provider identity, status, generatedAt,
 * model, or usage — those are NOT shared across providers and stay in
 * each provider's own normalizer.
 */
export function cleanStructuredFields(fields: Record<string, unknown>): CleanedAdvisoryFields | undefined {
  const summary = cleanText(fields.summary, MAX_SUMMARY_LEN);
  if (summary === undefined) return undefined;

  const out: CleanedAdvisoryFields = { summary };

  const suggestedNextAction = cleanText(fields.suggestedNextAction ?? fields.nextAction, MAX_NEXT_ACTION_LEN);
  if (suggestedNextAction) out.suggestedNextAction = suggestedNextAction;

  const risks = cleanStringArray(fields.risks, MAX_RISKS, MAX_RISK_LEN);
  if (risks) out.risks = risks;

  const reasoning = cleanText(fields.reasoning, MAX_REASONING_LEN);
  if (reasoning) out.reasoning = reasoning;

  const tags = cleanStringArray(fields.tags, MAX_TAGS, MAX_TAG_LEN);
  if (tags) out.tags = tags;

  const warnings = cleanStringArray(fields.warnings, MAX_WARNINGS, MAX_WARNING_LEN);
  if (warnings) out.warnings = warnings;

  return out;
}

function nonNegInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/**
 * Map an untyped provider usage object into the shared IntelligenceUsage
 * shape. No pricing table — estimatedCost stays 0 unless the provider
 * itself supplied a finite non-negative number. Accepts both Anthropic's
 * (inputTokens/input_tokens/outputTokens/output_tokens) and OpenAI's
 * (prompt_tokens/completion_tokens) key names — a provider's own
 * normalizer decides which raw object to pass in.
 */
export function normalizeUsageTokens(raw: unknown): { inputTokens: number; outputTokens: number; totalTokens: number; estimatedCost: number; currency: string; providerRequestId: string | null } {
  if (typeof raw !== "object" || raw === null) {
    return { inputTokens: 0, outputTokens: 0, totalTokens: 0, estimatedCost: 0, currency: "USD", providerRequestId: null };
  }
  const u = raw as Record<string, unknown>;
  const inputTokens = nonNegInt(u.inputTokens ?? u.input_tokens ?? u.prompt_tokens);
  const outputTokens = nonNegInt(u.outputTokens ?? u.output_tokens ?? u.completion_tokens);
  const estimatedCost =
    typeof u.estimatedCost === "number" && Number.isFinite(u.estimatedCost) && u.estimatedCost >= 0 ? u.estimatedCost : 0;
  return {
    inputTokens,
    outputTokens,
    totalTokens: inputTokens + outputTokens,
    estimatedCost,
    currency: typeof u.currency === "string" && u.currency.length === 3 ? u.currency.toUpperCase() : "USD",
    providerRequestId: typeof u.providerRequestId === "string" ? redactUuids(u.providerRequestId).slice(0, 128) : null,
  };
}
