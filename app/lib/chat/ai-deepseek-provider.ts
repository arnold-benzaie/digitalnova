import "server-only";
import OpenAI from "openai";
import type { AiProvider, AiProviderInput, AiProviderOutput } from "@/lib/chat/ai-provider";
import { buildSystemPrompt } from "@/lib/chat/openai-system-prompt";
import { structuredReplySchema, toProviderOutput, toConversationRole } from "@/lib/chat/ai-structured-reply";
import type { StructuredReply } from "@/lib/chat/ai-structured-reply";

/**
 * Real conversational provider #2, Preview-only (see getAiProvider() in
 * ai-provider.ts, which only ever imports this file when
 * AI_PROVIDER="deepseek" is explicitly set; unset in Production).
 *
 * DeepSeek's API is documented as OpenAI-compatible — verified directly
 * against api-docs.deepseek.com, not assumed, and two details turned
 * out to differ from the OpenAI provider (ai-openai-provider.ts), both
 * confirmed from DeepSeek's own docs rather than carried over blindly:
 *   1. DeepSeek exposes the Chat Completions surface (POST
 *      /chat/completions via the `openai` SDK's `client.chat.completions
 *      .create`), not the newer Responses API OpenAI recommends and
 *      this project's OpenAI provider uses.
 *   2. DeepSeek's JSON mode is `response_format: { type: "json_object" }`
 *      only — their docs do not document a strict `json_schema` mode
 *      like OpenAI's Structured Outputs. Per DeepSeek's own
 *      instructions, the word "json" and a concrete example of the
 *      desired shape must appear in the prompt (JSON_MODE_INSTRUCTIONS
 *      below). Consequently `structuredReplySchema` (ai-structured-
 *      reply.ts) is NOT a backup validation here the way it is for
 *      OpenAI — it's the only shape guarantee that exists at all.
 *   3. Their docs also note the API "may occasionally return empty
 *      content" — handled the same way as OpenAI's empty-output case:
 *      throw, which app/api/chat/route.ts's existing catch turns into
 *      the widget's ordinary "something went wrong, retry" UI. No
 *      retry-loop added here — one call per turn stays the rule (§13).
 *
 * Bug fix (Preview 502, "Unterminated string in JSON..."): DeepSeek's
 * `json_object` mode has no strict schema/grammar enforcement (point 2
 * above), so an ordinary, occasionally multi-sentence reply can come
 * back with a raw unescaped newline inside the "message" string, which
 * breaks JSON.parse. Two changes address this:
 *   a. Thinking mode — confirmed via api-docs.deepseek.com to be ON by
 *      default (high reasoning effort) unless explicitly disabled — is
 *      now turned off via the documented `thinking:{type:"disabled"}`
 *      extension. A concise commercial chat reply needs no chain-of-
 *      thought reasoning, so this is a reasonable, low-risk change on
 *      its own merits (cost/latency), independent of whether it was a
 *      contributing factor to the malformed output.
 *   b. A defensive parse pipeline (parseStructuredReply below): strip
 *      any ```json fences if present (simple prefix/suffix trim, never
 *      a regex-based JSON "repair"), parse, validate with the same
 *      Zod schema (still the final authority). On failure, exactly one
 *      retry is made with a stricter corrective instruction appended.
 *      If the retry also fails, a sanitized error is thrown — logging
 *      only an error-type token, the model, and the response length,
 *      never the raw content, the prompt, or the API key.
 *
 * Everything else — the shared system prompt, the shared structured-
 * reply → AiProviderOutput mapping (including the §9 backend action
 * gate: a model claiming show_lead_form is never enough on its own),
 * the bounded 12-message history, the single-call-per-turn budget, the
 * dependency-injected client for tests — is identical in spirit to the
 * OpenAI provider and reuses the exact same shared modules, not a
 * parallel implementation.
 */

const DEFAULT_MODEL = "deepseek-v4-flash";
const BASE_URL = "https://api.deepseek.com";
// DeepSeek's own JSON-mode docs say to set this "appropriately to avoid
// truncation" — modest headroom above the OpenAI provider's 600 (§13:
// one concise reply per turn, not a long generation) since DeepSeek's
// json_object mode has no strict schema to keep the model on-budget.
const MAX_TOKENS = 800;
const REQUEST_TIMEOUT_MS = 12_000;

type ChatCompletionsClient = Pick<OpenAI, "chat">;

let cachedClient: OpenAI | null = null;

/** Lazy — importing this module (e.g. via getAiProvider()'s dynamic
 * import when AI_PROVIDER isn't "deepseek") must never throw just
 * because DEEPSEEK_API_KEY happens to be unset; the error only surfaces
 * if the provider is actually invoked. */
function getDefaultClient(): OpenAI {
  const apiKey = process.env.DEEPSEEK_API_KEY;
  if (!apiKey) {
    throw new Error("ai-deepseek-provider: DEEPSEEK_API_KEY is not configured");
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey, baseURL: BASE_URL, timeout: REQUEST_TIMEOUT_MS });
  }
  return cachedClient;
}

// Required by DeepSeek's JSON mode (their docs: "Include the word
// 'json' in the system or user prompt, and provide an example of the
// desired JSON format") — appended to the shared system prompt, not a
// replacement for it.
const JSON_MODE_INSTRUCTIONS = `
Respond with a single json object matching exactly this shape (no other text, no markdown fences):
{"message": "your reply text", "language": "fr", "intent": "short internal label", "suggestions": ["gbp"], "action": {"type": "none"}}
"language" must be "fr" or "en". "action.type" must be "none" or "show_lead_form". "suggestions" is an array of 0 to 4 ids from the list above — never invent an id. The "message" value must be valid JSON string content: any line break inside it must be escaped as \\n, never a raw newline.`;

const RETRY_INSTRUCTION =
  "Your previous reply was not a single valid JSON object matching the required shape. Reply again with ONLY that JSON object — properly escape any line break inside \"message\" as \\n, no markdown fences, no text before or after it.";

type DeepseekMessage = { role: "system" | "user" | "assistant"; content: string };

// DeepSeek's Chat Completions API supports a `thinking` extension (see
// api-docs.deepseek.com/guides/thinking_mode) not modeled by the shared
// `openai` SDK's types — declared here so it can be set explicitly
// without an excess-property error, and passed through as a plain
// property (the SDK serializes the request body as-is).
type DeepseekChatParams = OpenAI.Chat.Completions.ChatCompletionCreateParamsNonStreaming & {
  thinking?: { type: "disabled" };
};

type StructuredReplyParseResult =
  | { ok: true; value: StructuredReply }
  | { ok: false; reason: "invalid_json" | "schema_validation_failed" };

/** Strips a single leading/trailing ```json (or ```) fence if the whole
 * response is wrapped in one — never a partial or regex-based repair of
 * broken JSON, just removal of a wrapper DeepSeek is known to sometimes
 * add despite JSON_MODE_INSTRUCTIONS asking it not to. */
function stripJsonFence(raw: string): string {
  const trimmed = raw.trim();
  const match = /^```(?:json)?\s*([\s\S]*?)\s*```$/.exec(trimmed);
  return match ? match[1].trim() : trimmed;
}

function parseStructuredReply(raw: string): StructuredReplyParseResult {
  let json: unknown;
  try {
    json = JSON.parse(stripJsonFence(raw));
  } catch {
    return { ok: false, reason: "invalid_json" };
  }
  const result = structuredReplySchema.safeParse(json);
  if (!result.success) {
    return { ok: false, reason: "schema_validation_failed" };
  }
  return { ok: true, value: result.data };
}

async function requestCompletion(client: ChatCompletionsClient, model: string, messages: DeepseekMessage[]): Promise<string> {
  const params: DeepseekChatParams = {
    model,
    messages,
    max_tokens: MAX_TOKENS,
    response_format: { type: "json_object" },
    // Enabled by default at "high" reasoning effort per DeepSeek's own
    // docs; not needed for a concise structured chat reply, and its
    // interaction with json_object mode is a documented gap in
    // DeepSeek's own guide — disabled outright rather than relied on.
    thinking: { type: "disabled" },
  };
  const response = await client.chat.completions.create(params);
  const raw = response.choices[0]?.message?.content;
  if (!raw) {
    throw new Error("ai-deepseek-provider: empty content from the Chat Completions API");
  }
  return raw;
}

/**
 * Factory rather than a bare object so tests can inject a fake client
 * (see ai-deepseek-provider.test.mjs) — `deepseekProvider` below is just
 * `createDeepseekProvider()` using the real, lazily-constructed client.
 */
export function createDeepseekProvider(clientOverride?: ChatCompletionsClient): AiProvider {
  async function generateReply(input: AiProviderInput): Promise<AiProviderOutput> {
    const client = clientOverride ?? getDefaultClient();
    const model = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;

    // input.history is already a bounded, oldest-first window (max 12
    // messages — see lib/chat/messages.ts::getRecentMessagesForProvider)
    // — no further truncation needed here (§5/§13).
    const messages: DeepseekMessage[] = [
      { role: "system", content: buildSystemPrompt(input.context) + JSON_MODE_INSTRUCTIONS },
      ...input.history.map((message) => ({ role: toConversationRole(message.senderType), content: message.content })),
      { role: "user", content: input.userMessage },
    ];

    const firstRaw = await requestCompletion(client, model, messages);
    const firstAttempt = parseStructuredReply(firstRaw);
    if (firstAttempt.ok) {
      return toProviderOutput(firstAttempt.value, input.userMessage);
    }

    // At most one controlled retry, strictly demanding schema-conformant
    // JSON — never more than a single extra call per turn (§13).
    const retryMessages: DeepseekMessage[] = [
      ...messages,
      { role: "assistant", content: firstRaw },
      { role: "user", content: RETRY_INSTRUCTION },
    ];
    const secondRaw = await requestCompletion(client, model, retryMessages);
    const secondAttempt = parseStructuredReply(secondRaw);
    if (secondAttempt.ok) {
      return toProviderOutput(secondAttempt.value, input.userMessage);
    }

    // Sanitized log: error type, model, response length only — never
    // the raw content, the system prompt, or DEEPSEEK_API_KEY.
    console.error("[ai-deepseek-provider] structured reply invalid after retry", {
      firstErrorType: firstAttempt.reason,
      secondErrorType: secondAttempt.reason,
      model,
      firstResponseLength: firstRaw.length,
      secondResponseLength: secondRaw.length,
    });
    throw new Error(`ai-deepseek-provider: ${secondAttempt.reason}`);
  }

  return { generateReply };
}

export const deepseekProvider: AiProvider = createDeepseekProvider();
