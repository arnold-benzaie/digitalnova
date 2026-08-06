"use client";

import { BarChart, Bar, Cell, XAxis, YAxis, CartesianGrid, Tooltip, ResponsiveContainer } from "recharts";
import type { Locale } from "@/lib/i18n/dictionaries";
import { formatNumber } from "@/lib/i18n/format";

/**
 * Views/calls/directions 30-day summary bar chart for the Client dashboard —
 * presentation only, fed by totals the caller already computed from data it
 * already fetched (see app/dashboard/page.tsx). No fetching, no business
 * logic here.
 */
const TOOLTIP_STYLE = {
  contentStyle: { borderRadius: 10, border: "1px solid #e2ddd8", fontSize: 12, padding: "8px 12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
  labelStyle: { fontWeight: 600, color: "#080808", marginBottom: 2 },
  cursor: { fill: "rgba(8,8,8,0.04)" },
};

export function MetricsSummaryChart({
  data,
  locale = "fr",
}: {
  data: { label: string; value: number; color: string }[];
  locale?: Locale;
}) {
  return (
    <ResponsiveContainer width="100%" height={240}>
      <BarChart data={data} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd8" vertical={false} />
        <XAxis dataKey="label" tick={{ fontSize: 11 }} stroke="#6b6b6b" interval={0} />
        <YAxis allowDecimals={false} tick={{ fontSize: 11 }} stroke="#6b6b6b" tickFormatter={(v: number) => formatNumber(v, locale)} />
        <Tooltip
          contentStyle={TOOLTIP_STYLE.contentStyle}
          labelStyle={TOOLTIP_STYLE.labelStyle}
          cursor={TOOLTIP_STYLE.cursor}
          formatter={(value) => [formatNumber(Number(value), locale), ""]}
        />
        <Bar dataKey="value" radius={[4, 4, 0, 0]}>
          {data.map((entry) => (
            <Cell key={entry.label} fill={entry.color} />
          ))}
        </Bar>
      </BarChart>
    </ResponsiveContainer>
  );
}
