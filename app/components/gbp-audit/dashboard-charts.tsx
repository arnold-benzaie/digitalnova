"use client";

import {
  ResponsiveContainer,
  BarChart,
  Bar,
  LineChart,
  Line,
  PieChart,
  Pie,
  Cell,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  Legend,
} from "recharts";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { auditStatusTone, type SemanticTone } from "@/lib/gbp-audit/status-colors";

const PM_NOIR = "#080808";

/**
 * Recharts renders SVG fills directly, so it can't read Tailwind classes or
 * CSS custom properties reliably — these hex values must stay mirrored to
 * the --pm-* tokens in app/globals.css and lib/gbp-audit/status-colors.ts.
 */
const TONE_HEX: Record<SemanticTone, string> = {
  neutral: "#6b6b6b", // --pm-gris
  warm: "#c8922a", // --pm-or
  good: "#34a853", // --pm-g-green
  bad: "#d52b1e", // --pm-rouge
  info: "#4285f4", // --pm-g-blue
  ai: "#6c5aa8", // --pm-violet
};

// Severity buckets (GBP_SEVERITIES): critical/important both read as urgent
// on a dashboard chart, so important gets a deeper gold than moderate to
// stay legend-distinguishable while remaining in the same WARM family.
const COLORS = { critical: TONE_HEX.bad, important: "#c8922a", moderate: "#e8b84b", opportunity: TONE_HEX.neutral };

const TOOLTIP_STYLE = {
  contentStyle: { borderRadius: 10, border: "1px solid #e2ddd8", fontSize: 12, padding: "8px 12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
  labelStyle: { fontWeight: 600, color: "#080808", marginBottom: 2 },
  cursor: { fill: "rgba(8,8,8,0.04)" },
};

export function AuditsOverTimeChart({ data, locale = "fr" }: { data: { date: string; count: number }[]; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.dashboard;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <LineChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd8" />
        <XAxis dataKey="date" tick={{ fontSize: 11 }} stroke="#6b6b6b" />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#6b6b6b" />
        <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} formatter={(value) => [String(value), t.auditsCreatedSeries]} />
        <Line type="monotone" dataKey="count" stroke={PM_NOIR} strokeWidth={2} dot={{ r: 3 }} name={t.auditsCreatedSeries} />
      </LineChart>
    </ResponsiveContainer>
  );
}

export function FindingsBySeverityChart({ data, locale = "fr" }: { data: { severity: string; label: string; count: number }[]; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.dashboard;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <PieChart margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <Pie data={data} dataKey="count" nameKey="label" innerRadius={58} outerRadius={92} paddingAngle={2}>
          {data.map((entry) => (
            <Cell key={entry.severity} fill={COLORS[entry.severity as keyof typeof COLORS] ?? TONE_HEX.neutral} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="bottom" />
        <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} formatter={(value) => [String(value), t.findingsSeries]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function StatusDistributionChart({ data, locale = "fr" }: { data: { status: string; count: number }[]; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.dashboard;
  return (
    <ResponsiveContainer width="100%" height={260}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd8" />
        <XAxis dataKey="status" tick={{ fontSize: 10 }} stroke="#6b6b6b" interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#6b6b6b" />
        <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} cursor={TOOLTIP_STYLE.cursor} formatter={(value) => [String(value), t.auditsSeries]} />
        <Bar dataKey="count" radius={[4, 4, 0, 0]} name={t.auditsSeries}>
          {data.map((entry) => (
            <Cell key={entry.status} fill={TONE_HEX[auditStatusTone(entry.status)]} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
