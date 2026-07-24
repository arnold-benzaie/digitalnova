export type SearchConsoleStatTotals = {
  clicks: number;
  impressions: number;
  averageCtr: number; // 0..1
  averagePosition: number;
};

/** Pure aggregation, shared by the client-portal and CRM Search Console views. */
export function computeSearchConsoleStats(
  metrics: { clicks: number; impressions: number; averagePositionCentiles: number }[],
): SearchConsoleStatTotals {
  const totals = metrics.reduce(
    (acc, m) => ({ clicks: acc.clicks + m.clicks, impressions: acc.impressions + m.impressions }),
    { clicks: 0, impressions: 0 },
  );
  const averageCtr = totals.impressions > 0 ? totals.clicks / totals.impressions : 0;
  const averagePosition = metrics.length
    ? metrics.reduce((sum, m) => sum + m.averagePositionCentiles, 0) / metrics.length / 100
    : 0;
  return { ...totals, averageCtr, averagePosition };
}
