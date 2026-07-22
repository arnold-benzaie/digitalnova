export type AnalyticsStatTotals = {
  sessions: number;
  activeUsers: number;
  pageviews: number;
  averageBounceRate: number; // 0..1
};

/** Pure aggregation, shared by the client-portal and CRM Analytics views. */
export function computeAnalyticsStats(
  metrics: { sessions: number; activeUsers: number; pageviews: number; bounceRateBasisPoints: number }[],
): AnalyticsStatTotals {
  const totals = metrics.reduce(
    (acc, m) => ({
      sessions: acc.sessions + m.sessions,
      activeUsers: acc.activeUsers + m.activeUsers,
      pageviews: acc.pageviews + m.pageviews,
    }),
    { sessions: 0, activeUsers: 0, pageviews: 0 },
  );
  const averageBounceRate = metrics.length
    ? metrics.reduce((sum, m) => sum + m.bounceRateBasisPoints, 0) / metrics.length / 10000
    : 0;
  return { ...totals, averageBounceRate };
}
