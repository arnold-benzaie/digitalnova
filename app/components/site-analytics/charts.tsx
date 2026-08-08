"use client";

import { ResponsiveContainer, BarChart, Bar, PieChart, Pie, Cell, XAxis, YAxis, CartesianGrid, Tooltip, Legend } from "recharts";
import type { DimensionBreakdownRow } from "@/lib/site-analytics";

/**
 * Same visual conventions as components/gbp-audit/dashboard-charts.tsx
 * (hex mirrors of the --pm-* tokens, shared tooltip styling, grid/axis
 * treatment) — generic over {label, value} rows instead of that file's
 * audit-specific shapes, since this reuses the SAME look across 7
 * different GA4 dimension breakdowns rather than one fixed shape.
 */
const BAR_HEX = "#4285f4"; // --pm-g-blue
const DONUT_HEX = ["#4285f4", "#34a853", "#c8922a", "#6c5aa8", "#d52b1e", "#6b7280"];

const TOOLTIP_STYLE = {
  contentStyle: { borderRadius: 10, border: "1px solid #e2ddd8", fontSize: 12, padding: "8px 12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
  labelStyle: { fontWeight: 600, color: "#080808", marginBottom: 2 },
  cursor: { fill: "rgba(8,8,8,0.04)" },
};

export function BreakdownBarChart({ data, seriesLabel }: { data: DimensionBreakdownRow[]; seriesLabel: string }) {
  if (data.length === 0) return <EmptyChartState />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <BarChart data={data} layout="vertical" margin={{ top: 4, right: 16, bottom: 0, left: 8 }}>
        <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd8" horizontal={false} />
        <XAxis type="number" allowDecimals={false} tick={{ fontSize: 11 }} stroke="#6b6b6b" />
        <YAxis type="category" dataKey="label" width={110} tick={{ fontSize: 11 }} stroke="#6b6b6b" />
        <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} cursor={TOOLTIP_STYLE.cursor} formatter={(value) => [String(value), seriesLabel]} />
        <Bar dataKey="value" radius={[0, 4, 4, 0]} fill={BAR_HEX} name={seriesLabel} />
      </BarChart>
    </ResponsiveContainer>
  );
}

export function BreakdownDonutChart({ data, seriesLabel }: { data: DimensionBreakdownRow[]; seriesLabel: string }) {
  if (data.length === 0) return <EmptyChartState />;
  return (
    <ResponsiveContainer width="100%" height={220}>
      <PieChart margin={{ top: 8, right: 8, bottom: 0, left: 8 }}>
        <Pie data={data} dataKey="value" nameKey="label" innerRadius={54} outerRadius={86} paddingAngle={2}>
          {data.map((entry, i) => (
            <Cell key={entry.label} fill={DONUT_HEX[i % DONUT_HEX.length]} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="bottom" />
        <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} formatter={(value) => [String(value), seriesLabel]} />
      </PieChart>
    </ResponsiveContainer>
  );
}

function EmptyChartState() {
  return <div className="flex h-[220px] items-center justify-center text-xs text-pm-gris">—</div>;
}
