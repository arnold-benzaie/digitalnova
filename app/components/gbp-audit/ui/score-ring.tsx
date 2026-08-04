import { SEMANTIC_BORDER, SEMANTIC_DOT, scoreTone } from "@/lib/gbp-audit/status-colors";

const SIZE_CLASS = {
  sm: "h-10 w-10 border-2 text-sm",
  md: "h-14 w-14 border-[3px] text-lg",
  lg: "h-20 w-20 border-4 text-2xl",
} as const;

/**
 * Shared score display: colored ring border around the number, tone from
 * lib/gbp-audit/status-colors.ts's scoreTone(). The number itself always
 * renders in text-pm-noir (never tone-colored) — the accompanying
 * scoreBand() label is what carries the reading for color-blind users and
 * screen readers, and it keeps every score number at full text contrast
 * regardless of tone (see SEMANTIC_BORDER's contrast notes).
 */
export function ScoreRing({
  score,
  size = "md",
  className = "",
}: {
  score: number | null | undefined;
  size?: "sm" | "md" | "lg";
  className?: string;
}) {
  const tone = scoreTone(score);
  return (
    <div
      className={`flex shrink-0 items-center justify-center rounded-full font-semibold tabular-nums text-pm-noir ${SIZE_CLASS[size]} ${SEMANTIC_BORDER[tone]} ${className}`}
    >
      {score ?? "—"}
    </div>
  );
}

/** Compact inline variant for table cells (e.g. audit-row.tsx) — a small tone dot next to a neutral number, never colored text. */
export function ScoreBadge({ score, className = "" }: { score: number | null | undefined; className?: string }) {
  const tone = scoreTone(score);
  return (
    <span className={`inline-flex items-center gap-1.5 font-semibold tabular-nums text-pm-noir ${className}`}>
      <span className={`h-2 w-2 shrink-0 rounded-full ${SEMANTIC_DOT[tone]}`} aria-hidden="true" />
      {score ?? "—"}
    </span>
  );
}
