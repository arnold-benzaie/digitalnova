"use client";

import { MessageCircle, X } from "lucide-react";
import { dictionaries, type Locale } from "@/lib/i18n/dictionaries";

export function ChatBubbleTrigger({
  locale,
  showWelcomeBubble,
  onOpen,
  onDismissBubble,
}: {
  locale: Locale;
  showWelcomeBubble: boolean;
  onOpen: () => void;
  onDismissBubble: () => void;
}) {
  const t = dictionaries[locale].chat;

  return (
    <div className="fixed right-4 bottom-4 z-50 flex flex-col items-end gap-3 sm:right-6 sm:bottom-6">
      {showWelcomeBubble && (
        <div className="animate-in fade-in slide-in-from-bottom-2 relative max-w-[260px] rounded-2xl rounded-br-sm border border-pm-gris-2 bg-pm-blanc p-3 shadow-pm-md motion-reduce:animate-none">
          <button
            type="button"
            onClick={onDismissBubble}
            aria-label={t.welcomeBubble.closeAriaLabel}
            className="absolute top-1.5 right-1.5 rounded-full p-1 text-pm-gris hover:bg-pm-gris-2/60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-bleu-eu/50"
          >
            <X className="size-3.5" aria-hidden="true" />
          </button>
          <button type="button" onClick={onOpen} className="block text-left text-sm whitespace-pre-line text-pm-noir">
            {t.welcomeBubble.text}
          </button>
        </div>
      )}

      <button
        type="button"
        onClick={onOpen}
        aria-label={t.trigger.ariaLabel}
        className="relative flex size-14 items-center justify-center rounded-full bg-pm-noir text-pm-blanc shadow-pm-md transition hover:bg-pm-noir/90 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-pm-bleu-eu/60 focus-visible:ring-offset-2"
      >
        <MessageCircle className="size-6" aria-hidden="true" />
        <span className="absolute top-0 right-0 block size-3 rounded-full border-2 border-pm-blanc bg-pm-g-green" aria-hidden="true" />
      </button>
    </div>
  );
}
