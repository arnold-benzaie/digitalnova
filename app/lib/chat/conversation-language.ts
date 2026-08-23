import type { ChatMessageRow } from "@/lib/chat/messages";

/**
 * Deterministic FR/EN resolution for the real LLM providers (Phase 2.1 —
 * language-consistency fix). Shared by ai-openai-provider.ts and
 * ai-deepseek-provider.ts so the priority rule lives in exactly one
 * place, never duplicated per provider.
 *
 * Root cause this exists for: the model was previously the sole judge of
 * which language to reply in (a soft "stay consistent" instruction in
 * the system prompt), with no code-level anchor — confirmed to drift on
 * real multi-turn DeepSeek conversations. This module computes the
 * language BEFORE the model is called, so the model is told authoritatively
 * which language to use instead of being trusted to infer it, and the
 * app never has to trust the model's own self-reported `language` field
 * for anything UI-visible (suggestion chips, lead form, buttons).
 *
 * Priority (exact order requested): 1) the CURRENT message's language,
 * only when clearly identifiable; 2) the active interface/widget locale
 * (the `locale` the client sent with this request); 3) the language
 * already established earlier in the conversation; 4) "fr".
 */
export type ConversationLanguage = "fr" | "en";

// Deliberately conservative: accented characters, elided apostrophes,
// and common function words that essentially never appear in the other
// language. Widened twice after real Preview tests surfaced gaps:
// 1) "Que me conseillez-vous ?" (no accents, no verb from the initial
//    short list) went undetected and fell through to the interface
//    locale instead of "fr".
// 2) "I'd like to talk to someone" — after an explicit FR->EN switch on
//    the app surface — also went undetected. There, falling through to
//    the interface locale is worse than on the site: the app has no
//    in-chat FR/EN toggle, so the interface locale sent with every
//    request is the page's fixed locale, not a live signal — an
//    undetected message silently pulled the conversation back to the
//    page's original language instead of respecting the switch. Adding
//    "i"/"i'd"/"i'll"/"i'm"/"i've" (a first-person pronoun that is, on
//    its own, essentially exclusively English in this context) plus
//    "talk"/"speak"/"someone" and their French counterparts closes this
//    specific gap without changing the priority order itself.
// Rather than keep chasing individual phrases, this checks a broad set
// of everyday function words (pronouns, articles, conjunctions, common
// verbs) via whole-word matching — words that essentially never occur in
// the other language, so a hit on one side with none on the other stays
// a safe, unambiguous signal. A message that hits BOTH or NEITHER still
// falls through to the next priority rule instead of guessing.
const FRENCH_WORDS =
  /\b(?:je|tu|il|elle|nous|vous|ils|elles|le|la|les|un|une|des|du|au|aux|et|ou|mais|donc|car|ne|pas|plus|très|bien|avec|sans|pour|dans|sur|sous|chez|que|qui|quoi|comment|pourquoi|quand|où|est|êtes|sommes|avez|faites|conseillez|conseillez-vous|voudrais|voulez|aimerais|pouvez|cherche|cherchez|besoin|merci|bonjour|bonsoir|salut|coucou|oui|non|c'est|s'il|quelqu'un|parler)\b/i;
const ENGLISH_WORDS =
  /\b(?:the|is|are|you|your|what|how|why|when|where|do|does|would|could|should|want|need|have|has|and|or|but|with|without|for|this|that|these|those|please|thanks|thank|hello|hi|hey|yes|no|run|advise|recommend|i|i'd|i'll|i'm|i've|talk|speak|someone)\b/i;
const FRENCH_ACCENTS = /[àâäéèêëîïôöùûüçœ]/i;

function hasFrenchSignal(text: string): boolean {
  return FRENCH_ACCENTS.test(text) || FRENCH_WORDS.test(text);
}
function hasEnglishSignal(text: string): boolean {
  return ENGLISH_WORDS.test(text);
}

// A deliberate mid-conversation switch request always wins over the
// generic marker lists above, checked first.
const SWITCH_TO_ENGLISH = /continue\s+in\s+english|in\s+english\s*,?\s*please|speak\s+english|switch\s+to\s+english/i;
const SWITCH_TO_FRENCH = /continuer\s+en\s+fran[cç]ais|en\s+fran[cç]ais\s+s'?il|passer\s+au\s+fran[cç]ais|parler\s+fran[cç]ais/i;

/** Returns the current message's clearly-identifiable language, or null
 * when the signal is weak/absent/mixed — callers must fall through to
 * the next priority rule on null, never guess. */
export function detectClearMessageLanguage(message: string): ConversationLanguage | null {
  const trimmed = message.trim();
  if (!trimmed) return null;
  if (SWITCH_TO_ENGLISH.test(trimmed)) return "en";
  if (SWITCH_TO_FRENCH.test(trimmed)) return "fr";
  const frenchHit = hasFrenchSignal(trimmed);
  const englishHit = hasEnglishSignal(trimmed);
  if (frenchHit && !englishHit) return "fr";
  if (englishHit && !frenchHit) return "en";
  return null;
}

/** Rule 3 fallback: scans the bounded history, most-recent-first, for
 * the last USER-authored message with a clear detected language. Reuses
 * the same conservative heuristic — no separate "history language"
 * concept, no new storage. */
function establishedLanguageFromHistory(history: ChatMessageRow[]): ConversationLanguage | null {
  for (let i = history.length - 1; i >= 0; i -= 1) {
    const message = history[i];
    if (message.senderType === "assistant") continue;
    const detected = detectClearMessageLanguage(message.content);
    if (detected) return detected;
  }
  return null;
}

export function resolveConversationLanguage(input: { currentMessage: string; interfaceLocale?: string; history: ChatMessageRow[] }): ConversationLanguage {
  const fromCurrentMessage = detectClearMessageLanguage(input.currentMessage);
  if (fromCurrentMessage) return fromCurrentMessage;

  if (input.interfaceLocale === "fr" || input.interfaceLocale === "en") return input.interfaceLocale;

  const fromHistory = establishedLanguageFromHistory(input.history);
  if (fromHistory) return fromHistory;

  return "fr";
}
