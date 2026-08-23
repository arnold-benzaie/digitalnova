import { AlertCircle, CheckCheck, Clock } from "lucide-react";
import { ChatAssistantAvatar } from "@/components/chat/chat-assistant-avatar";
import { cn } from "@/lib/utils";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

/**
 * Delivery status for the visitor/client's OWN messages only — never set
 * on assistant messages, which have no delivery-status semantics.
 *
 * Only two states are backend-guaranteed by the current architecture:
 * "sending" (the request is in flight — the widget has no way to observe
 * a separate "server received it" moment before the response arrives,
 * since /api/chat is one atomic request/response, not two round-trips)
 * and "delivered" (the 200 response came back with a valid reply, which
 * — because appendUserMessage() persists before the AI provider is even
 * called — means the user's message was BOTH persisted AND successfully
 * processed; a 502 could mean either failed, so the two can't be told
 * apart from a failure either). "failed" covers any non-2xx response or
 * network error. Never fabricate a fourth state this data can't support.
 */
export type ChatMessageStatus = "sending" | "delivered" | "failed";

export type ChatUiMessage = {
  id: string;
  senderType: "visitor" | "client" | "assistant" | "staff";
  content: string;
  createdAt: Date;
  status?: ChatMessageStatus;
};

function formatTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

function DeliveryStatusIcon({ status, locale }: { status: ChatMessageStatus; locale: Locale }) {
  const t = dictionaries[locale].chat.deliveryStatus;
  if (status === "sending") {
    return (
      <span title={t.sending} aria-label={t.sending} className="inline-flex">
        <Clock className="size-3 animate-pulse text-pm-gris motion-reduce:animate-none" aria-hidden="true" />
      </span>
    );
  }
  if (status === "failed") {
    return (
      <span title={t.failed} aria-label={t.failed} className="inline-flex">
        <AlertCircle className="size-3 text-pm-rouge" aria-hidden="true" />
      </span>
    );
  }
  return (
    <span title={t.delivered} aria-label={t.delivered} className="inline-flex">
      <CheckCheck className="size-3 text-pm-bleu-eu" aria-hidden="true" />
    </span>
  );
}

export function ChatMessageBubble({ message, locale }: { message: ChatUiMessage; locale: Locale }) {
  const isOwn = message.senderType === "visitor" || message.senderType === "client";
  const bubble = (
    <div className={cn("max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap", isOwn ? "bg-pm-bleu-eu text-pm-blanc rounded-br-sm" : "bg-pm-gris-2 text-pm-noir rounded-bl-sm")}>
      {message.content}
    </div>
  );
  const timestampRow = (
    <span className="mt-1 flex items-center gap-1 px-1 text-[10px] text-pm-gris">
      {formatTime(message.createdAt, locale)}
      {isOwn && message.status && <DeliveryStatusIcon status={message.status} locale={locale} />}
    </span>
  );

  // Own (visitor/client) messages stay exactly as before, no avatar,
  // right-aligned. The assistant side gets a small generic avatar to its
  // left — nothing else about the bubble/timestamp changes.
  if (isOwn) {
    return (
      <div className="flex flex-col items-end">
        {bubble}
        {timestampRow}
      </div>
    );
  }
  return (
    <div className="flex items-start gap-2">
      <ChatAssistantAvatar className="mt-0.5" />
      <div className="flex min-w-0 flex-col items-start">
        {bubble}
        {timestampRow}
      </div>
    </div>
  );
}
