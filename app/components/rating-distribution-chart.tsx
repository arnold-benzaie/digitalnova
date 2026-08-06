"use client";

import { PieChart, Pie, Cell, Legend, Tooltip, ResponsiveContainer } from "recharts";
import type { Locale } from "@/lib/i18n/dictionaries";
import { dictionaries } from "@/lib/i18n/dictionaries";

/**
 * Star-rating donut for the Client dashboard — presentation only, fed by
 * counts the caller already computed from data it already fetched (see
 * app/dashboard/page.tsx). No fetching, no business logic here.
 */
const RATING_COLORS: Record<number, string> = {
  5: "#34a853", // --pm-g-green
  4: "#8bc34a",
  3: "#c8922a", // --pm-or
  2: "#e07a3f",
  1: "#d52b1e", // --pm-rouge
};

const TOOLTIP_STYLE = {
  contentStyle: { borderRadius: 10, border: "1px solid #e2ddd8", fontSize: 12, padding: "8px 12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
  labelStyle: { fontWeight: 600, color: "#080808", marginBottom: 2 },
};

export function RatingDistributionChart({ counts, locale = "fr" }: { counts: { rating: number; count: number }[]; locale?: Locale }) {
  const t = dictionaries[locale].dashboard.home;
  const data = counts.filter((c) => c.count > 0).map((c) => ({ ...c, label: `${c.rating} ★` }));

  return (
    <ResponsiveContainer width="100%" height={240}>
      <PieChart margin={{ top: 4, right: 4, bottom: 0, left: 4 }}>
        <Pie data={data} dataKey="count" nameKey="label" innerRadius={52} outerRadius={82} paddingAngle={2}>
          {data.map((entry) => (
            <Cell key={entry.rating} fill={RATING_COLORS[entry.rating] ?? "#6b6b6b"} />
          ))}
        </Pie>
        <Legend wrapperStyle={{ fontSize: 11 }} verticalAlign="bottom" />
        <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} formatter={(value) => [String(value), t.tiles.reviews]} />
      </PieChart>
    </ResponsiveContainer>
  );
}
