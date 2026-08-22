"use client";

import { useEffect, useRef, useState } from "react";
import { Minus, RotateCcw, Send, X } from "lucide-react";
import { Button } from "@/components/ui/button";
import { Textarea } from "@/components/ui/textarea";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";
import { ChatMessageBubble, type ChatUiMessage } from "@/components/chat/chat-message";
import { ChatTypingIndicator } from "@/components/chat/chat-typing-indicator";
import { ChatLeadForm, type ChatLeadFormValues } from "@/components/chat/chat-lead-form";

export function ChatPanel({
  locale,
  messages,
  suggestions,
  isTyping,
  isOnline,
  errorMessage,
  showLeadForm,
  leadFormSubmitting,
  leadFormError,
  onSendMessage,
  onSuggestionClick,
  onSubmitLead,
  onCancelLead,
  onRetry,
  onClose,
  onMinimize,
}: {
  locale: Locale;
  messages: ChatUiMessage[];
  suggestions: string[];
  isTyping: boolean;
  isOnline: boolean;
  errorMessage: string | null;
  showLeadForm: boolean;
  leadFormSubmitting: boolean;
  leadFormError: string | null;
  onSendMessage: (content: string) => void;
  onSuggestionClick: (id: string) => void;
  onSubmitLead: (values: ChatLeadFormValues) => void;
  onCancelLead: () => void;
  onRetry: () => void;
  onClose: () => void;
  onMinimize: () => void;
}) {
  const t = dictionaries[locale].chat;
  const [draft, setDraft] = useState("");
  const scrollRef = useRef<HTMLDivElement>(null);

  useEffect(() => {
    scrollRef.current?.scrollTo({ top: scrollRef.current.scrollHeight, behavior: "smooth" });
  }, [messages.length, isTyping]);

  function submitDraft() {
    const trimmed = draft.trim();
    if (!trimmed) return;
    onSendMessage(trimmed);
    setDraft("");
  }

  return (
    <div
      role="dialog"
      aria-modal="false"
      aria-label={t.panel.assistantName}
      className="fixed inset-0 z-50 flex flex-col bg-pm-blanc sm:inset-auto sm:right-6 sm:bottom-6 sm:h-[560px] sm:w-[380px] sm:rounded-2xl sm:border sm:border-pm-gris-2 sm:shadow-pm-md"
      style={{ paddingBottom: "env(safe-area-inset-bottom)" }}
    >
      <header className="flex shrink-0 items-center justify-between gap-2 border-b border-pm-gris-2 bg-pm-noir px-4 py-3 text-pm-blanc sm:rounded-t-2xl">
        <div>
          <p className="text-sm font-semibold">{t.panel.assistantName}</p>
          <p className="flex items-center gap-1.5 text-xs text-pm-blanc/70">
            <span className={`size-1.5 rounded-full ${isOnline ? "bg-pm-g-green" : "bg-pm-gris"}`} aria-hidden="true" />
            {isOnline ? t.panel.onlineStatus : t.panel.offlineStatus}
          </p>
        </div>
        <div className="flex items-center gap-1">
          <button type="button" onClick={onMinimize} aria-label={t.panel.minimizeAriaLabel} className="rounded-full p-1.5 hover:bg-pm-blanc/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-blanc/50">
            <Minus className="size-4" aria-hidden="true" />
          </button>
          <button type="button" onClick={onClose} aria-label={t.panel.closeAriaLabel} className="rounded-full p-1.5 hover:bg-pm-blanc/10 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-blanc/50">
            <X className="size-4" aria-hidden="true" />
          </button>
        </div>
      </header>

      <div ref={scrollRef} className="flex-1 space-y-3 overflow-y-auto px-4 py-4">
        {messages.map((message) => (
          <ChatMessageBubble key={message.id} message={message} locale={locale} />
        ))}
        {isTyping && <ChatTypingIndicator label={t.typingIndicator} />}

        {errorMessage && (
          <div className="flex flex-col items-start gap-2 rounded-xl border border-pm-rouge/30 bg-pm-rouge/5 px-3 py-2">
            <p className="text-xs text-pm-rouge">{errorMessage}</p>
            <Button type="button" size="xs" variant="outline" onClick={onRetry} className="gap-1">
              <RotateCcw className="size-3" aria-hidden="true" />
              {t.errors.retry}
            </Button>
          </div>
        )}

        {showLeadForm && <ChatLeadForm locale={locale} submitting={leadFormSubmitting} errorMessage={leadFormError} onSubmit={onSubmitLead} onCancel={onCancelLead} />}

        {!showLeadForm && suggestions.length > 0 && (
          <div className="flex flex-wrap gap-2 pt-1">
            {suggestions.map((id) => {
              const label = t.suggestions.items[id];
              if (!label) return null;
              return (
                <button
                  key={id}
                  type="button"
                  onClick={() => onSuggestionClick(id)}
                  className="rounded-full border border-pm-gris-2 px-3 py-1.5 text-xs text-pm-noir transition hover:border-pm-bleu-eu hover:text-pm-bleu-eu focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-bleu-eu/50"
                >
                  {label}
                </button>
              );
            })}
          </div>
        )}
      </div>

      <form
        onSubmit={(event) => {
          event.preventDefault();
          submitDraft();
        }}
        className="flex shrink-0 items-end gap-2 border-t border-pm-gris-2 p-3"
      >
        <Textarea
          value={draft}
          onChange={(event) => setDraft(event.target.value)}
          onKeyDown={(event) => {
            if (event.key === "Enter" && !event.shiftKey) {
              event.preventDefault();
              submitDraft();
            }
          }}
          placeholder={t.input.placeholder}
          rows={1}
          maxLength={4000}
          className="max-h-24 min-h-0 resize-none py-2"
          aria-label={t.input.placeholder}
        />
        <Button type="submit" size="icon" aria-label={t.input.sendAriaLabel} disabled={!draft.trim()} className="shrink-0 bg-pm-noir hover:bg-pm-noir/90">
          <Send className="size-4" aria-hidden="true" />
        </Button>
      </form>
    </div>
  );
}
