"use client";

import { useState } from "react";
import { BreakdownBarChart } from "@/components/site-analytics/charts";
import type { GoogleAdsCampaignBreakdownMetric } from "@/lib/google-ads/reports";

/**
 * All 3 breakdowns (cost/conversions/clicks) are derived server-side from
 * the SAME campaign rows already fetched for the campaigns table (see
 * lib/google-ads/reports.ts::campaignBreakdown()) — no extra GAQL call.
 * Switching which one is shown is pure client-side state: no new request.
 */
export function GoogleAdsCampaignBreakdown({
  breakdowns,
  labels,
  emptyLabel,
}: {
  breakdowns: Record<GoogleAdsCampaignBreakdownMetric, { label: string; value: number }[]>;
  labels: Record<GoogleAdsCampaignBreakdownMetric, string>;
  emptyLabel: string;
}) {
  const metrics: GoogleAdsCampaignBreakdownMetric[] = ["costMicros", "conversions", "clicks"];
  const [metric, setMetric] = useState<GoogleAdsCampaignBreakdownMetric>("costMicros");
  const data = breakdowns[metric];

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
      {data.length === 0 ? <div className="flex h-[220px] items-center justify-center text-xs text-pm-gris">{emptyLabel}</div> : <BreakdownBarChart data={data} seriesLabel={labels[metric]} />}
    </div>
  );
}
