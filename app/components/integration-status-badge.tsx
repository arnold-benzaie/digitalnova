/**
 * Purely presentational status pill for Google integration rows (Compte
 * Google / Google Business Profile / Search Console / Analytics). Takes an
 * already-computed tone + label and renders text + icon + color — it has
 * no knowledge of Google, OAuth, sync state, or any business logic. Every
 * caller (components/google-connection-status.tsx, app/dashboard/gbp/page.tsx)
 * is responsible for mapping the real, already-fetched sync state to one of
 * these four tones; this component never decides that mapping itself.
 */
export type IntegrationBadgeTone = "good" | "warm" | "bad" | "neutral";

const TONE_CLASS: Record<IntegrationBadgeTone, string> = {
  good: "bg-pm-g-green/10 text-pm-g-green",
  warm: "bg-pm-or/10 text-pm-or-2",
  bad: "bg-pm-rouge/10 text-pm-rouge-2",
  neutral: "bg-pm-gris-2/60 text-pm-gris",
};

const TONE_ICON: Record<IntegrationBadgeTone, string> = {
  good: "✓",
  warm: "⏳",
  bad: "!",
  neutral: "○",
};

export function IntegrationStatusBadge({ label, tone, className = "" }: { label: string; tone: IntegrationBadgeTone; className?: string }) {
  return (
    <span className={`inline-flex shrink-0 items-center gap-1.5 rounded-full px-3 py-1 text-xs font-medium ${TONE_CLASS[tone]} ${className}`}>
      <span aria-hidden="true">{TONE_ICON[tone]}</span>
      {label}
    </span>
  );
}
