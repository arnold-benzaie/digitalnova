import type { Locale } from "@/lib/i18n/dictionaries";
import type { ChatContext } from "@/lib/chat/context";
import type { ChatMessageRow } from "@/lib/chat/messages";

// id only, never a label: suggestion CHIP TEXT is UI copy and must come
// from lib/i18n/dictionaries/chat.ts (see components/chat/chat-panel.tsx),
// never from the provider — this is what lets a real Phase-2 provider
// return the exact same shape without also becoming a second, competing
// source of FR/EN strings.
export type AiSuggestion = { id: string };

/** What the widget should do in response to this turn, beyond just
 * showing text — kept as a small closed union so the UI never has to
 * parse the reply text to decide behavior. `null`/absent means "just
 * show the reply." */
export type AiAction = { type: "show_lead_form" } | { type: "human_escalation_confirmed" } | null;

export type AiProviderInput = {
  locale: Locale;
  userMessage: string;
  /** Bounded, oldest-first window — see
   * lib/chat/messages.ts::getRecentMessagesForProvider(). Never the full
   * conversation history. */
  history: ChatMessageRow[];
  context: ChatContext;
  /** Which embed sent this request (see validation.ts's surfaceSchema) —
   * "app" (Next.js dashboard widget) by default, or "site" (public-map.com
   * marketing embed, Phase 1B). Purely a copy/suggestion-set selector,
   * never an authorization input. */
  surface?: "app" | "site";
};

export type AiProviderOutput = {
  reply: string;
  suggestions?: AiSuggestion[];
  action?: AiAction;
  /** The language `reply` (and suggestion/lead-form copy for this turn)
   * is actually in — see lib/chat/conversation-language.ts. Optional
   * because the mock provider doesn't set it (it always mirrors
   * `input.locale` deterministically already); real providers always
   * set it. app/api/chat/route.ts falls back to `body.locale` when
   * absent so mock-backed responses are unaffected. */
  language?: "fr" | "en";
};

/**
 * Provider abstraction (§7/§13 of the approved plan) — the rest of the
 * application (app/api/chat/route.ts, the widget UI) depends only on
 * this interface, never on `lib/chat/ai-mock-provider.ts` directly.
 * Confirmed exactly as designed: the Phase 2 real-LLM provider
 * (lib/chat/ai-openai-provider.ts) was one new file + one branch in
 * getAiProvider() below — nothing else in the app changed.
 *
 * Deliberately namespaced under lib/chat/ rather than lib/ai/ — this
 * app already has an unrelated, pre-existing `lib/ai/` module (GBP
 * audit-score/onboarding-summary generation, used by
 * lib/actions/audit.ts and lib/actions/onboarding.ts) with its own
 * `AIProvider`/`MockAIProvider`. Reusing that name would have silently
 * overwritten a working feature — see the Phase 1A report's incident
 * note.
 */
export interface AiProvider {
  generateReply(input: AiProviderInput): Promise<AiProviderOutput>;
}

/**
 * Phase 2: `AI_PROVIDER` selects the active provider — Preview-only in
 * practice, since Production never has this variable set (see the
 * Phase 2 report's env-var scope confirmation). Any unset/unrecognized
 * value falls back to the mock, so a missing or misconfigured var can
 * never accidentally activate a real, paid LLM anywhere — the safe
 * default stays exactly Phase 1's behavior.
 *
 * "openai" and "deepseek" are both real, fully-implemented providers —
 * only one is ever active at a time (whichever AI_PROVIDER names), and
 * switching between them is a config change, not a code change. Both
 * share the same system prompt, structured-output contract, and §9
 * backend action gate (see ai-structured-reply.ts) — the model choice
 * only changes which HTTP API answers, never the app-side guarantees.
 */
export async function getAiProvider(): Promise<AiProvider> {
  const providerName = process.env.AI_PROVIDER;

  if (providerName === "openai") {
    const { openaiProvider } = await import("@/lib/chat/ai-openai-provider");
    return openaiProvider;
  }

  if (providerName === "deepseek") {
    const { deepseekProvider } = await import("@/lib/chat/ai-deepseek-provider");
    return deepseekProvider;
  }

  const { mockAiProvider } = await import("@/lib/chat/ai-mock-provider");
  return mockAiProvider;
}
