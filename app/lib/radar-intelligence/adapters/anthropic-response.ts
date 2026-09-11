/**
 * RADAR INTELLIGENCE V1 — Slice 2 — pure Anthropic response normalization.
 * RADAR INTELLIGENCE V1.1 — structured (summary/risks/nextAction/reasoning)
 * output, with graceful degradation to plain-text summary.
 * RADAR INTELLIGENCE V2 — the structured-output contract, its caps, and
 * its graceful-degradation rule now live in the provider-agnostic
 * structured-advisory-parser.ts, shared with every other provider's
 * normalizer. This file keeps ONLY what is genuinely Anthropic-specific:
 * the Messages-API envelope shape ({content:[{type:"text",text}]}) and
 * Anthropic's own usage field names (inputTokens/input_tokens/...).
 *
 * Provider output is UNTRUSTED. This module validates the runtime shape
 * and turns anything unexpected into a safe PROVIDER_ERROR. It never
 * treats model text as a URL, command, assignment, HTML, SQL, or
 * server-action call — the result is advisory DISPLAY DATA only. No eval,
 * no dynamic code, no tool call.
 *
 * The produced IntelligenceAdvisory always has `advisory: true` and never
 * carries a deterministic priority / score / assignee.
 */
import type { IntelligenceAdvisory, IntelligenceConnectionStatus, IntelligenceResponse } from "../types";
import { makeIntelligenceError } from "../errors";
import { cleanText, cleanStructuredFields, normalizeUsageTokens, resolveStructuredFields } from "./structured-advisory-parser";
import { ANTHROPIC_PROVIDER_ID } from "./config";

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
    fields = resolveStructuredFields(text);
  }

  const cleaned = cleanStructuredFields(fields);
  if (cleaned === undefined) {
    return { ok: false, error: makeIntelligenceError("PROVIDER_ERROR", ANTHROPIC_PROVIDER_ID, "PROVIDER_PARSE") };
  }

  const status: IntelligenceConnectionStatus = "CONNECTED";
  const advisory: IntelligenceAdvisory = {
    advisory: true,
    provider: ANTHROPIC_PROVIDER_ID,
    status,
    generatedAt,
    ...cleaned,
  };

  // usage is always a SIBLING of `content` in the real Messages API
  // response, never something the model's own generated text could set —
  // always read off the raw top-level body, never off `fields`.
  advisory.usage = normalizeUsageTokens(b.usage);

  // The configured model id — non-secret configuration (see
  // adapters/config.ts), never anything from the response itself.
  const cleanModel = cleanText(model, 200);
  if (cleanModel) advisory.model = cleanModel;

  return { ok: true, advisory };
}
