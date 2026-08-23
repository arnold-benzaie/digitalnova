import "server-only";
import { z } from "zod";
import type { AiProviderOutput } from "@/lib/chat/ai-provider";
import type { ConversationLanguage } from "@/lib/chat/conversation-language";
import { isExplicitLeadIntent } from "@/lib/chat/ai-mock-provider";
import { isKnownSuggestionId } from "@/lib/chat/suggestion-catalog";

/**
 * Shared contract every real-LLM provider (OpenAI, DeepSeek, and any
 * future one) must produce, and the single place that turns it into the
 * app's actual `AiProviderOutput` — extracted so this "defense in
 * depth" logic is written and tested ONCE, not duplicated per provider
 * (per the original request: "je ne veux pas dupliquer toute la logique
 * métier pour chaque fournisseur").
 *
 * `structuredReplySchema` is what every provider must validate its raw
 * JSON against before trusting it — for OpenAI this is a second check
 * behind the API's own strict `json_schema` enforcement; for DeepSeek
 * (whose documented JSON mode is the older, unenforced
 * `{"type":"json_object"}` — verified via api-docs.deepseek.com, no
 * `json_schema` strict mode documented there) this Zod check is the
 * ONLY shape guarantee that exists at all, not a backup to one.
 */
export const structuredReplySchema = z.object({
  message: z.string().min(1).max(2000),
  language: z.enum(["fr", "en"]),
  intent: z.string().max(200),
  suggestions: z.array(z.string()),
  action: z.object({ type: z.enum(["none", "show_lead_form"]) }),
});

export type StructuredReply = z.infer<typeof structuredReplySchema>;

/**
 * Maps a validated structured reply down to the app's real
 * `AiProviderOutput` — unknown suggestion ids are dropped, suggestions
 * are capped at 4, and `show_lead_form` is only ever forwarded when the
 * CURRENT message independently, deterministically also matches
 * `isExplicitLeadIntent()` (the same keyword rules the mock provider's
 * own human/quote branches use). A model — of either provider —
 * hallucinating `show_lead_form` on an ordinary message can never open
 * the form on its claim alone.
 *
 * `resolvedLanguage` is the app-computed language (see
 * conversation-language.ts), NOT `parsed.language` — the model's own
 * self-reported language is validated by the schema but is never treated
 * as authoritative here, since trusting it is exactly what let a real
 * DeepSeek conversation drift language mid-conversation. Every UI-visible
 * consumer (suggestion chip labels, lead form, buttons) must use this
 * field, never re-derive language from the reply text.
 */
export function toProviderOutput(parsed: StructuredReply, userMessage: string, resolvedLanguage: ConversationLanguage): AiProviderOutput {
  const suggestions = parsed.suggestions
    .filter(isKnownSuggestionId)
    .slice(0, 4)
    .map((id) => ({ id }));

  const action = parsed.action.type === "show_lead_form" && isExplicitLeadIntent(userMessage) ? ({ type: "show_lead_form" } as const) : undefined;

  return { reply: parsed.message, suggestions, action, language: resolvedLanguage };
}

export function toConversationRole(senderType: string): "user" | "assistant" {
  return senderType === "assistant" ? "assistant" : "user";
}
