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
};

export type AiProviderOutput = {
  reply: string;
  suggestions?: AiSuggestion[];
  action?: AiAction;
};

/**
 * Provider abstraction (§7/§13 of the approved plan) — the rest of the
 * application (app/api/chat/route.ts, the widget UI) depends only on
 * this interface, never on `lib/chat/ai-mock-provider.ts` directly.
 * Swapping in a real provider in Phase 2 (lib/chat/ai-openai-provider.ts
 * or similar) means adding one new file + one line in getAiProvider()
 * below; nothing else changes.
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
 * Phase 1A: always the mock provider. No env var currently selects a
 * real provider — that selection mechanism is intentionally not built
 * yet (would imply a real provider already exists to select), added
 * only when Phase 2 is explicitly authorized.
 */
export async function getAiProvider(): Promise<AiProvider> {
  const { mockAiProvider } = await import("@/lib/chat/ai-mock-provider");
  return mockAiProvider;
}
