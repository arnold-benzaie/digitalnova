/**
 * RADAR INTELLIGENCE V2 — pure OpenAI response normalization.
 *
 * Mirrors anthropic-response.ts's structure exactly, delegating the
 * shared {summary, risks, nextAction, reasoning} contract, its caps, and
 * its graceful-degradation rule to structured-advisory-parser.ts. This
 * file keeps ONLY what is genuinely OpenAI-specific: the Chat Completions
 * envelope shape ({choices:[{message:{content}}]}) and OpenAI's own
 * usage field names (prompt_tokens/completion_tokens).
 *
 * Provider output is UNTRUSTED. Anything unexpected becomes a safe
 * PROVIDER_ERROR. The result is advisory DISPLAY DATA only — no eval, no
 * dynamic code, no tool call, no deterministic priority/score/assignee.
 */
import type { IntelligenceAdvisory, IntelligenceConnectionStatus, IntelligenceResponse } from "../types";
import { makeIntelligenceError } from "../errors";
import { cleanText, cleanStructuredFields, normalizeUsageTokens, resolveStructuredFields } from "./structured-advisory-parser";
import { OPENAI_PROVIDER_ID } from "./openai-config";

/**
 * Accept a provider body in a couple of tolerant shapes:
 *   { summary, suggestedNextAction | nextAction?, risks?, reasoning?, tags?, warnings?, usage? }
 *   { choices: [{ message: { content } }], usage? }   (Chat Completions shape)
 *
 * For the Chat Completions shape, `content` is itself expected to be the
 * JSON object the system instruction asked for (response_format:
 * json_object). If it parses, its fields are used directly. If it does
 * NOT parse, the raw text becomes the plain `summary` and
 * risks/nextAction/reasoning are simply absent — the advisory still
 * renders, never breaks, never fabricates a value that wasn't said.
 *
 * Anything from which no usable summary can be extracted -> PROVIDER_ERROR.
 */
export function normalizeOpenAiResponse(body: unknown, generatedAt: string, model?: string): IntelligenceResponse {
  if (typeof body !== "object" || body === null) {
    return { ok: false, error: makeIntelligenceError("PROVIDER_ERROR", OPENAI_PROVIDER_ID, "PROVIDER_PARSE") };
  }
  const b = body as Record<string, unknown>;

  let fields: Record<string, unknown> = b;
  if (typeof b.summary !== "string" && Array.isArray(b.choices)) {
    const text = b.choices
      .filter((c): c is { message?: unknown } => typeof c === "object" && c !== null)
      .map((c) => {
        const message = (c as { message?: unknown }).message;
        return typeof message === "object" && message !== null && typeof (message as { content?: unknown }).content === "string"
          ? (message as { content: string }).content
          : "";
      })
      .join(" ")
      .trim();
    fields = resolveStructuredFields(text);
  }

  const cleaned = cleanStructuredFields(fields);
  if (cleaned === undefined) {
    return { ok: false, error: makeIntelligenceError("PROVIDER_ERROR", OPENAI_PROVIDER_ID, "PROVIDER_PARSE") };
  }

  const status: IntelligenceConnectionStatus = "CONNECTED";
  const advisory: IntelligenceAdvisory = {
    advisory: true,
    provider: OPENAI_PROVIDER_ID,
    status,
    generatedAt,
    ...cleaned,
  };

  // usage is always a SIBLING of `choices` in the real Chat Completions
  // response, never something the model's own generated text could set —
  // always read off the raw top-level body, never off `fields`.
  advisory.usage = normalizeUsageTokens(b.usage);

  const cleanModel = cleanText(model, 200);
  if (cleanModel) advisory.model = cleanModel;

  return { ok: true, advisory };
}
