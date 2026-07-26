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

const PM_NOIR = "#080808";
const PM_ROUGE = "#d52b1e";
const COLORS = { critical: "#d52b1e", important: "#f59e0b", moderate: "#3b82f6", opportunity: "#9ca3af" };

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
    <ResponsiveContainer width="100%" height={220}>
      <PieChart>
        <Pie data={data} dataKey="count" nameKey="label" innerRadius={50} outerRadius={80} paddingAngle={2}>
          {data.map((entry) => (
            <Cell key={entry.severity} fill={COLORS[entry.severity as keyof typeof COLORS] ?? "#9ca3af"} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 11 }} />
        <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} formatter={(value) => [String(value), t.findingsSeries]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

export function StatusDistributionChart({ data, locale = "fr" }: { data: { status: string; count: number }[]; locale?: Locale }) {
  const t = dictionaries[locale].auditModule.dashboard;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd8" />
        <XAxis dataKey="status" tick={{ fontSize: 10 }} stroke="#6b6b6b" interval={0} angle={-15} textAnchor="end" height={50} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#6b6b6b" />
        <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} cursor={TOOLTIP_STYLE.cursor} formatter={(value) => [String(value), t.auditsSeries]} />
        <Bar dataKey="count" fill={PM_ROUGE} radius={[4, 4, 0, 0]} name={t.auditsSeries} />
      </BarChart>
    </ResponsiveContainer>
  );
}
