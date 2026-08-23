/**
 * A small, generic "support agent" glyph (headset + mic) — deliberately
 * abstract, no identifiable person, no photo. Humanizes the assistant's
 * messages visually without implying a real human is answering; the
 * name next to it always stays "PUBLIC-MAP Assistant" (never a human
 * name or "conseiller en ligne" unless a real human escalation has
 * actually happened elsewhere in the flow — untouched by this).
 */
export function ChatAssistantAvatar({ className }: { className?: string }) {
  return (
    <span
      aria-hidden="true"
      className={`flex size-6 shrink-0 items-center justify-center rounded-full bg-[linear-gradient(135deg,#60a5fa,#3b82f6_55%,#2563eb)] text-pm-blanc ${className ?? ""}`}
    >
      <svg width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" strokeWidth="2" strokeLinecap="round" strokeLinejoin="round">
        <circle cx="12" cy="8.5" r="3.2" />
        <path d="M5.5 19.5c0-3.3 2.9-6 6.5-6s6.5 2.7 6.5 6" />
        <path d="M6.2 8.5a5.8 5.8 0 0 1 11.6 0" />
        <path d="M6.2 8.5v2a1.2 1.2 0 0 0 1.2 1.2h.3" />
        <circle cx="8.3" cy="11.9" r="0.9" fill="currentColor" stroke="none" />
        <rect x="5.3" y="7.6" width="1.8" height="2.8" rx="0.6" />
        <rect x="16.9" y="7.6" width="1.8" height="2.8" rx="0.6" />
      </svg>
    </span>
  );
}
