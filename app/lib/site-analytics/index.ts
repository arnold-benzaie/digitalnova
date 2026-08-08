import "server-only";
import { getCachedTrafficAnalytics } from "./cache";
import { getBusinessMetrics } from "./business-metrics";
import type { BusinessMetrics, SiteTrafficAnalytics } from "./types";

export type SiteAnalyticsDashboardData = {
  traffic: SiteTrafficAnalytics;
  business: BusinessMetrics;
};

/** Single entry point for app/admin/analytics/page.tsx. */
export async function getSiteAnalyticsDashboardData(): Promise<SiteAnalyticsDashboardData> {
  const [traffic, business] = await Promise.all([getCachedTrafficAnalytics(), getBusinessMetrics()]);
  return { traffic, business };
}

export type { BusinessMetrics, SiteTrafficAnalytics, SiteAnalyticsKpis, SiteAnalyticsBreakdowns, DimensionBreakdownRow, TopPageRow } from "./types";
