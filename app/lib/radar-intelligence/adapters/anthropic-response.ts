/**
 * RADAR INTELLIGENCE V1 — Slice 2 — pure Anthropic response normalization.
 *
 * Provider output is UNTRUSTED. This module validates the runtime shape,
 * drops unknown fields, truncates oversized fields, and turns anything
 * unexpected into a safe PROVIDER_ERROR. It never treats model text as a
 * URL, command, assignment, HTML, SQL, or server-action call — the result
 * is advisory DISPLAY DATA only. No eval, no dynamic code, no tool call.
 *
 * The produced IntelligenceAdvisory always has `advisory: true` and never
 * carries a deterministic priority / score / assignee.
 */
import { EMPTY_USAGE, type IntelligenceAdvisory, type IntelligenceConnectionStatus, type IntelligenceResponse, type IntelligenceUsage } from "../types";
import { makeIntelligenceError } from "../errors";
import { redactUuids } from "../sanitize-context";
import { ANTHROPIC_PROVIDER_ID } from "./config";

const MAX_SUMMARY_LEN = 1_200;
const MAX_NEXT_ACTION_LEN = 160;
const MAX_TAGS = 8;
const MAX_TAG_LEN = 40;
const MAX_WARNINGS = 6;
const MAX_WARNING_LEN = 200;

function cleanText(value: unknown, maxLen: number): string | undefined {
  if (typeof value !== "string") return undefined;
  const t = redactUuids(value).trim().slice(0, maxLen);
  return t.length > 0 ? t : undefined;
}

function cleanStringArray(value: unknown, maxItems: number, maxLen: number): string[] | undefined {
  if (!Array.isArray(value)) return undefined;
  const out: string[] = [];
  for (const item of value) {
    const t = cleanText(item, maxLen);
    if (t) out.push(t);
    if (out.length >= maxItems) break;
  }
  return out.length > 0 ? out : undefined;
}

function nonNegInt(value: unknown): number {
  return typeof value === "number" && Number.isFinite(value) && value >= 0 ? Math.trunc(value) : 0;
}

/** Map an untyped provider usage object into IntelligenceUsage. No pricing
 * table — estimatedCost stays 0 unless the provider itself supplied a
 * finite non-negative number. */
function normalizeUsage(raw: unknown): IntelligenceUsage {
  if (typeof raw !== "object" || raw === null) return { ...EMPTY_USAGE };
  const u = raw as Record<string, unknown>;
  const inputTokens = nonNegInt(u.inputTokens ?? u.input_tokens);
  const outputTokens = nonNegInt(u.outputTokens ?? u.output_tokens);
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

/**
 * Accept a provider body in a couple of tolerant shapes:
 *   { summary, suggestedNextAction?, tags?, warnings?, usage? }
 *   { content: [{ type: "text", text }], usage? }   (Messages-API-ish)
 * Anything else -> PROVIDER_ERROR.
 */
export function normalizeAnthropicResponse(body: unknown, generatedAt: string): IntelligenceResponse {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: makeIntelligenceError("PROVIDER_ERROR", ANTHROPIC_PROVIDER_ID, "PROVIDER_PARSE") };
  }
  const b = body as Record<string, unknown>;

  let summary = cleanText(b.summary, MAX_SUMMARY_LEN);
  if (summary === undefined && Array.isArray(b.content)) {
    const text = b.content
      .filter((c): c is { type?: unknown; text?: unknown } => typeof c === "object" && c !== null)
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join(" ")
      .trim();
    summary = cleanText(text, MAX_SUMMARY_LEN);
  }

  if (summary === undefined) {
    return { ok: false, error: makeIntelligenceError("PROVIDER_ERROR", ANTHROPIC_PROVIDER_ID, "PROVIDER_PARSE") };
  }

  const status: IntelligenceConnectionStatus = "CONNECTED";
  const advisory: IntelligenceAdvisory = {
    advisory: true,
    provider: ANTHROPIC_PROVIDER_ID,
    status,
    generatedAt,
    summary,
  };

  const suggestedNextAction = cleanText(b.suggestedNextAction, MAX_NEXT_ACTION_LEN);
  if (suggestedNextAction) advisory.suggestedNextAction = suggestedNextAction;

  const tags = cleanStringArray(b.tags, MAX_TAGS, MAX_TAG_LEN);
  if (tags) advisory.tags = tags;

  const warnings = cleanStringArray(b.warnings, MAX_WARNINGS, MAX_WARNING_LEN);
  if (warnings) advisory.warnings = warnings;

  advisory.usage = normalizeUsage(b.usage);

  return { ok: true, advisory };
}
