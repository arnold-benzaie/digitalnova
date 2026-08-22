import "server-only";
import OpenAI from "openai";
import type { AiProvider, AiProviderInput, AiProviderOutput } from "@/lib/chat/ai-provider";
import { buildSystemPrompt } from "@/lib/chat/openai-system-prompt";
import { SUGGESTION_IDS } from "@/lib/chat/suggestion-catalog";
import { structuredReplySchema, toProviderOutput, toConversationRole } from "@/lib/chat/ai-structured-reply";

/**
 * Phase 2 — real conversational provider, Preview-only (see
 * getAiProvider() in ai-provider.ts, which only ever imports this file
 * when AI_PROVIDER="openai" is explicitly set; unset in Production).
 *
 * Uses the OpenAI Responses API (OpenAI's current recommendation for
 * new integrations over the older Chat Completions API — verified
 * directly, not assumed) with Structured Outputs (`text.format`,
 * `strict: true`) so the model's reply is always exactly
 * `{ message, language, intent, suggestions, action }` — never free-form
 * text the rest of the app would have to parse or trust blindly.
 *
 * The `{ message, language, intent, suggestions, action }` → real
 * `AiProviderOutput` mapping (including the §9 backend action gate —
 * see ai-structured-reply.ts) is shared with the DeepSeek provider
 * (ai-deepseek-provider.ts), not duplicated.
 *
 * Every thrown error here (missing key, network failure, timeout, 429,
 * 5xx, malformed JSON, schema mismatch) propagates unmodified to
 * app/api/chat/route.ts's existing try/catch, which already turns any
 * provider error into a generic `502 { error: "provider_unavailable" }`
 * — nothing here needs its own error-shaping, and the raw OpenAI error
 * (which could include request metadata) never reaches the client.
 *
 * Testability: `createOpenaiProvider(client?)` accepts an injected
 * client instead of relying on `node:test`'s `mock.module("openai", …)`
 * — tried first, but it silently failed to intercept the bare "openai"
 * package under tsx (the real SDK still ran, making a genuine network
 * call to api.openai.com with a fake key and getting a real 401 back).
 * Plain dependency injection sidesteps that loader-interaction issue
 * entirely and guarantees the test suite never makes a real request.
 */

const DEFAULT_MODEL = "gpt-5.4-mini";
// Generous enough for a 2–5 sentence reply plus the small JSON envelope
// around it, capped well below the model's 128k ceiling — one call per
// turn, no reason for a long response in a chat-widget context (§13).
const MAX_OUTPUT_TOKENS = 600;
const REQUEST_TIMEOUT_MS = 12_000;

type ResponsesClient = Pick<OpenAI, "responses">;

let cachedClient: OpenAI | null = null;

/** Lazy — importing this module (e.g. via getAiProvider()'s dynamic
 * import when AI_PROVIDER isn't "openai") must never throw just because
 * OPENAI_API_KEY happens to be unset; the error only surfaces if the
 * provider is actually invoked. */
function getDefaultClient(): OpenAI {
  const apiKey = process.env.OPENAI_API_KEY;
  if (!apiKey) {
    throw new Error("ai-openai-provider: OPENAI_API_KEY is not configured");
  }
  if (!cachedClient) {
    cachedClient = new OpenAI({ apiKey, timeout: REQUEST_TIMEOUT_MS });
  }
  return cachedClient;
}

// Plain JSON Schema (not Zod) — this is what's sent to OpenAI's
// Structured Outputs (`text.format.schema`) in strict mode, which
// requires every property to be `required` and `additionalProperties:
// false` (no true optionality inside strict schemas). structuredReplySchema
// (ai-structured-reply.ts) is the Zod mirror validated server-side —
// defense in depth behind this, not a replacement for it.
const RESPONSE_JSON_SCHEMA = {
  type: "object",
  properties: {
    message: { type: "string", description: "The natural-language reply to show the visitor, 2-5 sentences." },
    language: { type: "string", enum: ["fr", "en"], description: "The language `message` is written in." },
    intent: { type: "string", description: "A short internal label for what the visitor is asking about (not shown to the visitor)." },
    suggestions: {
      type: "array",
      items: { type: "string", enum: SUGGESTION_IDS },
      description: "0 to 4 suggestion ids from the allowed list, only when genuinely relevant right now.",
    },
    action: {
      type: "object",
      properties: { type: { type: "string", enum: ["none", "show_lead_form"] } },
      required: ["type"],
      additionalProperties: false,
    },
  },
  required: ["message", "language", "intent", "suggestions", "action"],
  additionalProperties: false,
} as const;

/**
 * Factory rather than a bare object so tests can inject a fake client
 * (see ai-openai-provider.test.mjs) — `openaiProvider` below is just
 * `createOpenaiProvider()` using the real, lazily-constructed client.
 */
export function createOpenaiProvider(clientOverride?: ResponsesClient): AiProvider {
  async function generateReply(input: AiProviderInput): Promise<AiProviderOutput> {
    const client = clientOverride ?? getDefaultClient();
    const model = process.env.AI_MODEL?.trim() || DEFAULT_MODEL;

    // input.history is already a bounded, oldest-first window (max 12
    // messages — see lib/chat/messages.ts::getRecentMessagesForProvider)
    // — no further truncation needed here (§5/§13).
    const conversationInput = [
      ...input.history.map((message) => ({ role: toConversationRole(message.senderType), content: message.content })),
      { role: "user" as const, content: input.userMessage },
    ];

    const response = await client.responses.create({
      model,
      instructions: buildSystemPrompt(input.context),
      input: conversationInput,
      max_output_tokens: MAX_OUTPUT_TOKENS,
      text: {
        format: {
          type: "json_schema",
          name: "public_map_assistant_reply",
          strict: true,
          schema: RESPONSE_JSON_SCHEMA,
        },
      },
    });

    const raw = response.output_text;
    if (!raw) {
      throw new Error("ai-openai-provider: empty output_text from the Responses API");
    }

    const parsed = structuredReplySchema.parse(JSON.parse(raw));
    return toProviderOutput(parsed, input.userMessage);
  }

  return { generateReply };
}

export const openaiProvider: AiProvider = createOpenaiProvider();
