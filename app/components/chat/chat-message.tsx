import { cn } from "@/lib/utils";
import type { Locale } from "@/lib/i18n/dictionaries";

export type ChatUiMessage = {
  id: string;
  senderType: "visitor" | "client" | "assistant" | "staff";
  content: string;
  createdAt: Date;
};

function formatTime(date: Date, locale: Locale): string {
  return new Intl.DateTimeFormat(locale === "en" ? "en-US" : "fr-FR", { hour: "2-digit", minute: "2-digit" }).format(date);
}

export function ChatMessageBubble({ message, locale }: { message: ChatUiMessage; locale: Locale }) {
  const isOwn = message.senderType === "visitor" || message.senderType === "client";
  return (
    <div className={cn("flex flex-col", isOwn ? "items-end" : "items-start")}>
      <div
        className={cn(
          "max-w-[80%] rounded-2xl px-3 py-2 text-sm whitespace-pre-wrap",
          isOwn ? "bg-pm-bleu-eu text-pm-blanc rounded-br-sm" : "bg-pm-gris-2 text-pm-noir rounded-bl-sm",
        )}
      >
        {message.content}
      </div>
      <span className="mt-1 px-1 text-[10px] text-pm-gris">{formatTime(message.createdAt, locale)}</span>
    </div>
  );
}
