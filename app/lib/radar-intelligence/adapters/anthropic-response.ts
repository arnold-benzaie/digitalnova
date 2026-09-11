/**
 * RADAR INTELLIGENCE V1 — Slice 2 — pure Anthropic response normalization.
 * RADAR INTELLIGENCE V1.1 — structured (summary/risks/nextAction/reasoning)
 * output, with graceful degradation to plain-text summary.
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
const MAX_RISKS = 6;
const MAX_RISK_LEN = 120;
const MAX_REASONING_LEN = 400;

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

/** Strip a ```json ... ``` (or bare ``` ... ```) fence around `text`, if
 * the model wrapped its JSON in one despite being asked not to. */
function stripJsonFence(text: string): string {
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
function tryParseStructuredText(text: string): Record<string, unknown> | undefined {
  try {
    const parsed: unknown = JSON.parse(stripJsonFence(text));
    return typeof parsed === "object" && parsed !== null && !Array.isArray(parsed) ? (parsed as Record<string, unknown>) : undefined;
  } catch {
    return undefined;
  }
}

/**
 * Accept a provider body in a couple of tolerant shapes:
 *   { summary, suggestedNextAction | nextAction?, risks?, reasoning?, tags?, warnings?, usage? }
 *   { content: [{ type: "text", text }], usage? }   (Messages-API shape)
 *
 * For the Messages-API shape, `text` is itself expected to be the JSON
 * object the system instruction asked for. If it parses, its fields are
 * used directly (GRACEFUL structured path). If it does NOT parse (the
 * model replied with plain prose, or something else went wrong), the
 * raw text becomes the plain `summary` and risks/nextAction/reasoning
 * are simply absent — the advisory still renders, never breaks, and
 * never fabricates a value that wasn't actually said.
 *
 * Anything from which no usable summary can be extracted -> PROVIDER_ERROR.
 */
export function normalizeAnthropicResponse(body: unknown, generatedAt: string, model?: string): IntelligenceResponse {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: makeIntelligenceError("PROVIDER_ERROR", ANTHROPIC_PROVIDER_ID, "PROVIDER_PARSE") };
  }
  const b = body as Record<string, unknown>;

  // Prefer an already-structured top-level object (fakes, or a future
  // direct-JSON provider mode); otherwise fall back to the Messages-API
  // shape, where the model's own text is expected to itself be the JSON
  // object the system instruction requested.
  let fields: Record<string, unknown> = b;
  if (typeof b.summary !== "string" && Array.isArray(b.content)) {
    const text = b.content
      .filter((c): c is { type?: unknown; text?: unknown } => typeof c === "object" && c !== null)
      .map((c) => (typeof c.text === "string" ? c.text : ""))
      .join(" ")
      .trim();
    fields = tryParseStructuredText(text) ?? { summary: text };
  }

  const summary = cleanText(fields.summary, MAX_SUMMARY_LEN);
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

  // Accept either key name — the system instruction asks for "nextAction",
  // older fakes/tests may still use "suggestedNextAction".
  const suggestedNextAction = cleanText(fields.suggestedNextAction ?? fields.nextAction, MAX_NEXT_ACTION_LEN);
  if (suggestedNextAction) advisory.suggestedNextAction = suggestedNextAction;

  const risks = cleanStringArray(fields.risks, MAX_RISKS, MAX_RISK_LEN);
  if (risks) advisory.risks = risks;

  const reasoning = cleanText(fields.reasoning, MAX_REASONING_LEN);
  if (reasoning) advisory.reasoning = reasoning;

  const tags = cleanStringArray(fields.tags, MAX_TAGS, MAX_TAG_LEN);
  if (tags) advisory.tags = tags;

  const warnings = cleanStringArray(fields.warnings, MAX_WARNINGS, MAX_WARNING_LEN);
  if (warnings) advisory.warnings = warnings;

  // usage is always a SIBLING of `content` in the real Messages API
  // response, never something the model's own generated text could set —
  // always read off the raw top-level body, never off `fields`.
  advisory.usage = normalizeUsage(b.usage);

  // The configured model id — non-secret configuration (see
  // adapters/config.ts), never anything from the response itself.
  const cleanModel = cleanText(model, 200);
  if (cleanModel) advisory.model = cleanModel;

  return { ok: true, advisory };
}
