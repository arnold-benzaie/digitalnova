/** DTOs for the internal /admin/analytics dashboard. GA4-sourced shapes
 * mirror what the Data API returns (already-aggregated numbers, never raw
 * event/user-level data) — nothing here is per-visitor identifiable. */

export type DateRangeKey = "today" | "7d" | "30d" | "90d";

export type SiteAnalyticsKpis = {
  visitorsToday: number;
  visitors7d: number;
  visitors30d: number;
  visitors90d: number;
  activeUsers: number;
  sessions: number;
  pageviews: number;
  avgSessionDurationSeconds: number;
  engagementRate: number; // 0..1
};

export type DimensionBreakdownRow = { label: string; value: number };

export type TopPageRow = { path: string; pageviews: number };

export type SiteAnalyticsBreakdowns = {
  trafficSources: DimensionBreakdownRow[];
  countries: DimensionBreakdownRow[];
  cities: DimensionBreakdownRow[];
  devices: DimensionBreakdownRow[];
  operatingSystems: DimensionBreakdownRow[];
  browsers: DimensionBreakdownRow[];
  languages: DimensionBreakdownRow[];
  topPages: TopPageRow[];
};

/** null fields mean "GA4 unavailable" (no/invalid service account
 * configured, or the API call failed) — the page must render a clear
 * "unavailable" state per field/section, never fall back to a fake 0
 * that looks like real data. */
export type SiteTrafficAnalytics = {
  kpis: SiteAnalyticsKpis | null;
  breakdowns: SiteAnalyticsBreakdowns | null;
  unavailableReason: string | null;
};

/** Business metrics come straight from PUBLIC-MAP's own Postgres tables —
 * always available, never "unavailable" the way GA4 can be. Revenue/
 * conversions are real aggregates over invoices/subscriptions as they
 * exist today; 0 here means "no data recorded", never a placeholder. */
export type BusinessMetrics = {
  quoteRequests30d: number;
  auditsStarted30d: number;
  auditsCompleted30d: number;
  loginsThisWeek: number;
  conversions30d: number; // quote requests that became a signed/won deal
  revenue30dEuros: number;
  paidInvoiceCount30d: number;
};
