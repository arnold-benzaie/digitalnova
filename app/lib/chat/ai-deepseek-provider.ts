import "server-only";
import OpenAI from "openai";
import type { AiProvider, AiProviderInput, AiProviderOutput } from "@/lib/chat/ai-provider";
import { buildSystemPrompt } from "@/lib/chat/openai-system-prompt";
import { structuredReplySchema, toProviderOutput, toConversationRole } from "@/lib/chat/ai-structured-reply";

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
// truncation" — same budget as the OpenAI provider (§13: one concise
// reply per turn, not a long generation).
const MAX_TOKENS = 600;
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
"language" must be "fr" or "en". "action.type" must be "none" or "show_lead_form". "suggestions" is an array of 0 to 4 ids from the list above — never invent an id.`;

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
    const messages = [
      { role: "system" as const, content: buildSystemPrompt(input.context) + JSON_MODE_INSTRUCTIONS },
      ...input.history.map((message) => ({ role: toConversationRole(message.senderType), content: message.content })),
      { role: "user" as const, content: input.userMessage },
    ];

    const response = await client.chat.completions.create({
      model,
      messages,
      max_tokens: MAX_TOKENS,
      response_format: { type: "json_object" },
    });

    const raw = response.choices[0]?.message?.content;
    if (!raw) {
      throw new Error("ai-deepseek-provider: empty content from the Chat Completions API");
    }

    const parsed = structuredReplySchema.parse(JSON.parse(raw));
    return toProviderOutput(parsed, input.userMessage);
  }

  return { generateReply };
}

export const deepseekProvider: AiProvider = createDeepseekProvider();
