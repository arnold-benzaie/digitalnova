import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { EmptyState } from "@/components/gbp-audit/ui/empty-state";
import { NAV_ICONS } from "@/components/gbp-audit/ui/nav-icons";

type Message = {
  id: string;
  senderRole: string;
  senderName: string;
  body: string;
  createdAt: Date;
};

export function MessageThread({ messages, locale = "fr" }: { messages: Message[]; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.messages;

  if (messages.length === 0) {
    return <EmptyState icon={<NAV_ICONS.mail width={22} height={22} />} title={t.empty} description={t.emptyHint} />;
  }

  return (
    <div className="flex flex-col gap-3">
      {messages.map((message) => {
        const isStaff = message.senderRole === "staff";
        return (
          <div key={message.id} className={`flex ${isStaff ? "justify-end" : "justify-start"}`}>
            <div
              className={`max-w-md rounded-2xl px-4 py-3 shadow-pm-sm ${
                isStaff ? "bg-pm-bleu-eu text-white" : "border border-pm-gris-2 bg-white text-pm-noir"
              }`}
            >
              <div className="flex items-center justify-between gap-4">
                <p className={`text-xs font-medium ${isStaff ? "text-white/70" : "text-pm-gris"}`}>
                  {message.senderName}
                </p>
                <p className={`text-xs ${isStaff ? "text-white/50" : "text-pm-gris"}`}>
                  {formatDate(message.createdAt, locale, { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                </p>
              </div>
              <p className="mt-1 whitespace-pre-wrap text-sm">{message.body}</p>
            </div>
          </div>
        );
      })}
    </div>
  );
}
