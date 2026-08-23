"use client";

import { useEffect, useRef, useState } from "react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { ChatBubbleTrigger } from "@/components/chat/chat-bubble-trigger";
import { ChatPanel } from "@/components/chat/chat-panel";
import type { ChatLeadFormValues } from "@/components/chat/chat-lead-form";
import type { ChatUiMessage } from "@/components/chat/chat-message";
import { ChatApiError, sendChatMessage, submitChatLead } from "@/components/chat/chat-api";
import { trackClientEvent } from "@/lib/actions/product-events";

const STORAGE_KEY = "pm_chat_state_v1";
const MAX_STORED_MESSAGES = 50;

type StoredState = { conversationId: string | null; messages: { id: string; senderType: ChatUiMessage["senderType"]; content: string; createdAt: string }[] };

function loadStoredState(): StoredState | null {
  if (typeof window === "undefined") return null;
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as StoredState;
  } catch {
    return null;
  }
}

function saveStoredState(conversationId: string | null, messages: ChatUiMessage[]) {
  if (typeof window === "undefined") return;
  try {
    const trimmed = messages.slice(-MAX_STORED_MESSAGES).map((message) => ({ ...message, createdAt: message.createdAt.toISOString() }));
    window.localStorage.setItem(STORAGE_KEY, JSON.stringify({ conversationId, messages: trimmed }));
  } catch {
    // Storage full/unavailable (private browsing, etc.) — the widget still
    // works within the current tab session, it just won't resume after a
    // refresh. Never blocks the conversation itself.
  }
}

function trackIfAuthenticated(isAuthenticated: boolean, eventType: string, metadata?: Record<string, unknown>) {
  if (!isAuthenticated) return;
  void trackClientEvent({ eventType, metadata });
}

export function ChatWidget({ locale, firstName, isAuthenticated }: { locale: Locale; firstName: string | null; isAuthenticated: boolean }) {
  // The conversation's actual established language — distinct from
  // `locale` (the app's own interface-locale prop, always sent to the
  // backend as the "interface locale" signal — see
  // lib/chat/conversation-language.ts's priority rule). Every UI-visible
  // piece of copy (suggestion chips, lead form, buttons, errors, retry,
  // placeholder) follows THIS value, not the static `locale` prop, once
  // a real conversation is underway — otherwise a French exchange could
  // show English chips just because the interface locale never changed.
  // Resyncs to `locale` immediately when it changes (a genuine interface
  // toggle), and otherwise follows each response's own resolved
  // `language` — never re-derived from `locale` alone once a message has
  // actually been exchanged.
  const [conversationLocale, setConversationLocale] = useState<Locale>(locale);
  useEffect(() => {
    setConversationLocale(locale);
  }, [locale]);

  const t = dictionaries[conversationLocale].chat;

  // Resume after refresh (§14/§23) — restored from localStorage via a
  // lazy useState initializer (runs once, synchronously, before first
  // paint) rather than an effect that calls setState: this component is
  // only ever rendered client-side (ssr:false, see chat-widget-mount.tsx),
  // so there's no server-rendered HTML for a localStorage-derived initial
  // value to ever mismatch against.
  const [initialStored] = useState(() => loadStoredState());

  const [phase, setPhase] = useState<"closed" | "open">("closed");
  const [showWelcomeBubble, setShowWelcomeBubble] = useState(false);
  const [bubbleDismissed, setBubbleDismissed] = useState(() => Boolean(initialStored?.conversationId));
  const [conversationId, setConversationId] = useState<string | null>(() => initialStored?.conversationId ?? null);
  const [messages, setMessages] = useState<ChatUiMessage[]>(() => initialStored?.messages.map((message) => ({ ...message, createdAt: new Date(message.createdAt) })) ?? []);
  const [suggestions, setSuggestions] = useState<string[]>([]);
  const [isTyping, setIsTyping] = useState(false);
  const [isRetrying, setIsRetrying] = useState(false);
  const [errorMessage, setErrorMessage] = useState<string | null>(null);
  // Consecutive failures for the CURRENT outstanding message only — reset
  // on any success, never persisted (§4: a per-conversation-attempt
  // signal, not a stored/backend concept). At 2, the panel offers the
  // advisor CTA alongside the normal Retry, never opening the lead form
  // on its own (§4: "ne pas ouvrir automatiquement le formulaire").
  const [consecutiveFailures, setConsecutiveFailures] = useState(0);
  const [showLeadForm, setShowLeadForm] = useState(false);
  const [leadFormSubmitting, setLeadFormSubmitting] = useState(false);
  const [leadFormError, setLeadFormError] = useState<string | null>(null);
  const lastFailedContentRef = useRef<string | null>(null);
  const hasViewedRef = useRef(false);

  useEffect(() => {
    saveStoredState(conversationId, messages);
  }, [conversationId, messages]);

  useEffect(() => {
    if (!hasViewedRef.current) {
      hasViewedRef.current = true;
      trackIfAuthenticated(isAuthenticated, "chat_widget_viewed");
    }
  }, [isAuthenticated]);

  // Welcome bubble: appears once, 2-4s after mount, only if the visitor
  // hasn't already opened the widget or dismissed/resumed a conversation.
  // Never opens the full panel automatically.
  useEffect(() => {
    if (bubbleDismissed || phase !== "closed") return;
    const delay = 2000 + Math.random() * 2000;
    const timer = window.setTimeout(() => {
      setShowWelcomeBubble(true);
    }, delay);
    return () => window.clearTimeout(timer);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [bubbleDismissed]);

  function openPanel() {
    setPhase("open");
    setShowWelcomeBubble(false);
    setBubbleDismissed(true);
    trackIfAuthenticated(isAuthenticated, "chat_opened");
  }

  function closePanel() {
    setPhase("closed");
    trackIfAuthenticated(isAuthenticated, "chat_closed");
  }

  function minimizePanel() {
    setPhase("closed");
  }

  function dismissBubble() {
    setShowWelcomeBubble(false);
    setBubbleDismissed(true);
  }

  function appendLocalMessage(senderType: ChatUiMessage["senderType"], content: string): string {
    const id = `local-${crypto.randomUUID()}`;
    setMessages((prev) => [...prev, { id, senderType, content, createdAt: new Date() }]);
    return id;
  }

  /** Shared by both a normal send and a Retry — `appendUserBubble: false`
   * on retry is what stops a second, identical user bubble from
   * appearing (§2/§3): the original bubble from the failed attempt is
   * already in `messages` and is never removed on error, so nothing
   * needs to be re-added, only re-sent. */
  async function performSend(content: string, suggestionId: string | undefined, appendUserBubble: boolean) {
    setErrorMessage(null);
    if (appendUserBubble) {
      appendLocalMessage(isAuthenticated ? "client" : "visitor", content);
      trackIfAuthenticated(isAuthenticated, "chat_message_sent");
    }
    setSuggestions([]);
    setIsTyping(true);
    lastFailedContentRef.current = content;

    try {
      // Always the real interface locale (rule 2's input), never
      // `conversationLocale` — see the comment above conversationLocale's
      // declaration.
      const result = await sendChatMessage({ content, locale, conversationId, suggestionId });
      setConversationId(result.conversationId);
      if (result.language === "fr" || result.language === "en") {
        setConversationLocale(result.language);
      }
      setMessages((prev) => [...prev, { id: `assistant-${crypto.randomUUID()}`, senderType: "assistant", content: result.reply, createdAt: new Date() }]);
      setSuggestions(result.suggestions.map((suggestion) => suggestion.id));
      if (result.action?.type === "show_lead_form") {
        setShowLeadForm(true);
        trackIfAuthenticated(isAuthenticated, "lead_form_opened");
      }
      lastFailedContentRef.current = null;
      setConsecutiveFailures(0);
    } catch (err) {
      setErrorMessage(err instanceof ChatApiError && err.kind === "rate_limited" ? t.errors.rateLimited : t.errors.generic);
      trackIfAuthenticated(isAuthenticated, "chat_error", { kind: err instanceof ChatApiError ? err.kind : "unknown" });
      setConsecutiveFailures((n) => n + 1);
    } finally {
      setIsTyping(false);
      setIsRetrying(false);
    }
  }

  function handleSend(content: string, suggestionId?: string) {
    void performSend(content, suggestionId, true);
  }

  function handleSuggestionClick(id: string) {
    const label = t.suggestions.items[id];
    if (!label) return;
    trackIfAuthenticated(isAuthenticated, "suggested_question_clicked", { suggestionId: id });
    if (id === "human") {
      trackIfAuthenticated(isAuthenticated, "human_support_requested");
    }
    handleSend(label, id);
  }

  function handleRetry() {
    // isRetrying/isTyping both gate this — a raw double-click can't fire
    // a second in-flight attempt (§3).
    if (!lastFailedContentRef.current || isRetrying || isTyping) return;
    setIsRetrying(true);
    void performSend(lastFailedContentRef.current, undefined, false);
  }

  /** The advisor CTA offered after repeated failures (§4) reuses the
   * exact same lead-form path the AI itself can trigger — never a
   * separate mechanism, and never opened except on this explicit click. */
  function handleTalkToAdvisorAfterFailures() {
    setErrorMessage(null);
    setConsecutiveFailures(0);
    setShowLeadForm(true);
    trackIfAuthenticated(isAuthenticated, "lead_form_opened", { reason: "repeated_failure" });
  }

  async function handleSubmitLead(values: ChatLeadFormValues) {
    if (!conversationId) return;
    setLeadFormSubmitting(true);
    setLeadFormError(null);
    try {
      // Here `conversationLocale` IS what we want (not the raw interface
      // `locale`): this only picks which language the deterministic
      // confirmation text is drafted in, so it should match whatever
      // language the conversation has actually been in.
      const result = await submitChatLead({ conversationId, locale: conversationLocale, consent: true, surface: "app", ...values });
      setMessages((prev) => [...prev, { id: `assistant-${crypto.randomUUID()}`, senderType: "assistant", content: result.reply, createdAt: new Date() }]);
      setShowLeadForm(false);
      trackIfAuthenticated(isAuthenticated, "lead_submitted");
    } catch {
      setLeadFormError(t.errors.generic);
    } finally {
      setLeadFormSubmitting(false);
    }
  }

  const greeting = firstName ? t.panel.greetingNamed(firstName) : isAuthenticated ? t.panel.greetingFallback : t.panel.greetingAnonymous;
  const displayMessages = messages.length === 0 ? [{ id: "greeting", senderType: "assistant" as const, content: greeting, createdAt: new Date() }] : messages;

  return (
    <>
      {phase === "closed" && <ChatBubbleTrigger locale={conversationLocale} showWelcomeBubble={showWelcomeBubble} onOpen={openPanel} onDismissBubble={dismissBubble} />}
      {phase === "open" && (
        <ChatPanel
          locale={conversationLocale}
          messages={displayMessages}
          suggestions={suggestions}
          isTyping={isTyping}
          isOnline
          errorMessage={errorMessage}
          isRetrying={isRetrying}
          showAdvisorCta={consecutiveFailures >= 2}
          showLeadForm={showLeadForm}
          leadFormSubmitting={leadFormSubmitting}
          leadFormError={leadFormError}
          onSendMessage={(content) => handleSend(content)}
          onSuggestionClick={handleSuggestionClick}
          onSubmitLead={(values) => void handleSubmitLead(values)}
          onCancelLead={() => setShowLeadForm(false)}
          onRetry={handleRetry}
          onTalkToAdvisor={handleTalkToAdvisorAfterFailures}
          onClose={closePanel}
          onMinimize={minimizePanel}
        />
      )}
    </>
  );
}
