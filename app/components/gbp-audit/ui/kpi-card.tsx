import type { ReactNode } from "react";
import type { SemanticTone } from "@/lib/gbp-audit/status-colors";

const TONE_STYLE: Record<SemanticTone, { accent: string; icon: string }> = {
  neutral: { accent: "bg-pm-gris-2", icon: "bg-pm-gris-2/35 text-pm-gris" },
  info: { accent: "bg-pm-g-blue", icon: "bg-pm-g-blue/10 text-pm-bleu-eu" },
  warm: { accent: "bg-pm-or", icon: "bg-pm-or/10 text-pm-or" },
  good: { accent: "bg-pm-g-green", icon: "bg-pm-g-green/10 text-pm-g-green" },
  bad: { accent: "bg-pm-rouge", icon: "bg-pm-rouge/10 text-pm-rouge-2" },
  ai: { accent: "bg-pm-violet", icon: "bg-pm-violet/10 text-pm-violet-2" },
};

/**
 * Premium KPI tile — replaces the hand-rolled `rounded-2xl border ... p-4/p-5`
 * pattern repeated independently across app/admin/audit/page.tsx's 8 cards.
 * `trend` is optional and always rendered with its sign/label, never a bare
 * colored arrow.
 */
export function KpiCard({
  label,
  value,
  icon,
  trend,
  footer,
  tone = "neutral",
  className = "",
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  /** Free-form caption under the label — a link, a count, anything that
   * isn't a directional trend (use `trend` for that instead). */
  footer?: ReactNode;
  tone?: SemanticTone;
  className?: string;
}) {
  // Arrow glyph carries the tone color (decorative, not held to text-contrast
  // ratios); the label itself stays text-pm-gris — --pm-g-green has no darker
  // variant and only reaches ~3:1 on white, below AA's 4.5:1 for 12px text
  // (same gap noted for the badge system in status-colors.ts). pm-rouge-2
  // does pass at this size, but staying neutral for the label keeps both
  // directions visually consistent.
  const arrowTone = trend ? (trend.direction === "up" ? "text-pm-g-green" : trend.direction === "down" ? "text-pm-rouge-2" : "text-pm-gris") : "";
  const toneStyle = TONE_STYLE[tone];
  return (
    <div
      className={`animate-premium-fade-in relative min-h-[112px] overflow-hidden rounded-2xl border border-pm-gris-2 bg-white p-5 shadow-[0_7px_18px_rgba(13,36,67,0.06)] transition-[box-shadow,transform,border-color] duration-200 hover:-translate-y-0.5 hover:border-[#d7e2f0] hover:shadow-[0_13px_28px_rgba(13,36,67,0.12)] ${className}`}
    >
      <span className={`absolute inset-x-4 top-0 h-[3px] rounded-b-full ${toneStyle.accent}`} aria-hidden="true" />
      <div className="flex items-center justify-between">
        <p className="text-[26px] font-bold leading-none tabular-nums text-pm-noir">{value}</p>
        {icon && <span className={`flex h-8 w-8 shrink-0 items-center justify-center rounded-[10px] ${toneStyle.icon}`}>{icon}</span>}
      </div>
      <p className="mt-3.5 text-[13px] font-semibold leading-snug text-pm-gris">{label}</p>
      {trend && (
        <p className="mt-2 text-xs font-medium text-pm-gris">
          <span className={arrowTone} aria-hidden="true">
            {trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "—"}
          </span>{" "}
          {trend.label}
        </p>
      )}
      {footer}
    </div>
  );
}
