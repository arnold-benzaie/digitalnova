"use client";

import { useState } from "react";
import { ResponsiveContainer, LineChart, Line, XAxis, YAxis, CartesianGrid, Tooltip } from "recharts";
import type { GoogleAdsDailyMetric } from "@/lib/google-ads/reports";

/** Same visual conventions as components/gbp-audit/dashboard-charts.tsx's
 * AuditsOverTimeChart (grid/axis treatment, tooltip styling). */
const LINE_HEX = "#4285f4"; // --pm-g-blue
const TOOLTIP_STYLE = {
  contentStyle: { borderRadius: 10, border: "1px solid #e2ddd8", fontSize: 12, padding: "8px 12px", boxShadow: "0 4px 12px rgba(0,0,0,0.08)" },
  labelStyle: { fontWeight: 600, color: "#080808", marginBottom: 2 },
};

export type GoogleAdsChartMetric = "impressions" | "clicks" | "costMicros" | "conversions" | "ctr" | "averageCpcMicros";

/**
 * The full daily series (all metrics, every day of the period) is fetched
 * ONCE server-side — see lib/google-ads/reports.ts::getGoogleAdsAnalyticsReport().
 * Switching which metric is plotted is pure client-side state over that
 * SAME already-fetched array: no new request, no page reload.
 */
export function GoogleAdsTimeSeriesChart({
  data,
  currencyCode,
  labels,
}: {
  data: GoogleAdsDailyMetric[];
  currencyCode: string | null;
  labels: Record<GoogleAdsChartMetric, string>;
}) {
  const metrics: GoogleAdsChartMetric[] = ["impressions", "clicks", "costMicros", "conversions", "ctr", "averageCpcMicros"];
  const [metric, setMetric] = useState<GoogleAdsChartMetric>("impressions");

  if (data.length === 0) {
    return <div className="flex h-[240px] items-center justify-center text-xs text-pm-gris">—</div>;
  }

  const isMoney = metric === "costMicros" || metric === "averageCpcMicros";
  const isPercent = metric === "ctr";
  const chartData = data.map((row) => ({
    date: row.date,
    value: isMoney ? Number(row[metric]) / 1_000_000 : isPercent ? row.ctr * 100 : Number(row[metric]),
  }));

  const formatValue = (v: number): string => {
    if (isMoney) return `${v.toLocaleString("fr-FR", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}${currencyCode ? ` ${currencyCode}` : ""}`;
    if (isPercent) return `${v.toFixed(2)}%`;
    return v.toLocaleString("fr-FR");
  };

  return (
    <div>
      <div className="mb-3 flex flex-wrap gap-1.5" role="tablist">
        {metrics.map((m) => (
          <button
            key={m}
            type="button"
            role="tab"
            aria-selected={metric === m}
            onClick={() => setMetric(m)}
            className={`rounded-full border px-3 py-1 text-xs font-medium transition ${
              m === metric ? "border-pm-bleu-eu bg-pm-bleu-eu/10 text-pm-bleu-eu" : "border-pm-gris-2 text-pm-gris hover:bg-pm-gris-2/20"
            }`}
          >
            {labels[m]}
          </button>
        ))}
      </div>
      <ResponsiveContainer width="100%" height={240}>
        <LineChart data={chartData} margin={{ top: 8, right: 8, bottom: 0, left: -12 }}>
          <CartesianGrid strokeDasharray="3 3" stroke="#e2ddd8" />
          <XAxis dataKey="date" tick={{ fontSize: 10 }} stroke="#6b6b6b" />
          <YAxis tick={{ fontSize: 11 }} stroke="#6b6b6b" tickFormatter={formatValue} width={70} />
          <Tooltip contentStyle={TOOLTIP_STYLE.contentStyle} labelStyle={TOOLTIP_STYLE.labelStyle} formatter={(value) => [formatValue(Number(value)), labels[metric]]} />
          <Line type="monotone" dataKey="value" stroke={LINE_HEX} strokeWidth={2.5} dot={{ r: 3, fill: "#ffffff", stroke: LINE_HEX, strokeWidth: 2 }} name={labels[metric]} />
        </LineChart>
      </ResponsiveContainer>
    </div>
  );
}
