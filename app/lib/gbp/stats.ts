export type GbpMetricTotals = {
  views: number;
  calls: number;
  directionRequests: number;
  websiteClicks: number;
  averageRating: number | null;
  reviewCount: number;
};

/** Pure aggregation, shared by the client-portal and CRM GBP views so the
 * two never compute "the same number" two different ways. */
export function computeGbpStats(
  metrics: { views: number; calls: number; directionRequests: number; websiteClicks: number }[],
  reviewRatings: number[],
): GbpMetricTotals {
  const totals = metrics.reduce(
    (acc, m) => ({
      views: acc.views + m.views,
      calls: acc.calls + m.calls,
      directionRequests: acc.directionRequests + m.directionRequests,
      websiteClicks: acc.websiteClicks + m.websiteClicks,
    }),
    { views: 0, calls: 0, directionRequests: 0, websiteClicks: 0 },
  );
  const averageRating = reviewRatings.length ? reviewRatings.reduce((a, b) => a + b, 0) / reviewRatings.length : null;
  return { ...totals, averageRating, reviewCount: reviewRatings.length };
}
