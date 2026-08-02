import type { ReactNode } from "react";

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
  className = "",
}: {
  label: string;
  value: string | number;
  icon?: ReactNode;
  trend?: { direction: "up" | "down" | "flat"; label: string };
  className?: string;
}) {
  // Arrow glyph carries the tone color (decorative, not held to text-contrast
  // ratios); the label itself stays text-pm-gris — --pm-g-green has no darker
  // variant and only reaches ~3:1 on white, below AA's 4.5:1 for 12px text
  // (same gap noted for the badge system in status-colors.ts). pm-rouge-2
  // does pass at this size, but staying neutral for the label keeps both
  // directions visually consistent.
  const arrowTone = trend ? (trend.direction === "up" ? "text-pm-g-green" : trend.direction === "down" ? "text-pm-rouge-2" : "text-pm-gris") : "";
  return (
    <div className={`animate-premium-fade-in rounded-2xl border border-pm-gris-2 bg-white p-5 shadow-pm-sm transition-shadow hover:shadow-pm-md ${className}`}>
      <div className="flex items-center justify-between">
        <p className="text-2xl font-bold tabular-nums text-pm-noir">{value}</p>
        {icon && <span className="flex h-8 w-8 shrink-0 items-center justify-center rounded-full bg-pm-gris-2/30 text-pm-gris">{icon}</span>}
      </div>
      <p className="mt-1 text-sm font-medium text-pm-gris">{label}</p>
      {trend && (
        <p className="mt-2 text-xs font-medium text-pm-gris">
          <span className={arrowTone} aria-hidden="true">
            {trend.direction === "up" ? "▲" : trend.direction === "down" ? "▼" : "—"}
          </span>{" "}
          {trend.label}
        </p>
      )}
    </div>
  );
}
