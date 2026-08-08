import "server-only";
import { google, type analyticsdata_v1beta } from "googleapis";
import type { BaseExternalAccountClient } from "google-auth-library";
import { getGa4Auth } from "./auth";
import type { DimensionBreakdownRow, SiteAnalyticsBreakdowns, SiteAnalyticsKpis, SiteTrafficAnalytics, TopPageRow } from "./types";

/**
 * Reads PUBLIC-MAP's own GA4 property via the Analytics Data API
 * (already-aggregated reporting numbers — never per-visitor data).
 * Mirrors the class-based "real provider" shape used elsewhere
 * (lib/gbp/real-provider.ts, lib/searchconsole/real-provider.ts) but
 * without their per-organization OAuth constructor, since this is one
 * fixed agency property rather than a client's own.
 */

const BREAKDOWN_DIMENSIONS: Array<{ key: keyof Omit<SiteAnalyticsBreakdowns, "topPages">; dimension: string }> = [
  { key: "trafficSources", dimension: "sessionDefaultChannelGroup" },
  { key: "countries", dimension: "country" },
  { key: "cities", dimension: "city" },
  { key: "devices", dimension: "deviceCategory" },
  { key: "operatingSystems", dimension: "operatingSystem" },
  { key: "browsers", dimension: "browser" },
  { key: "languages", dimension: "language" },
];

const BREAKDOWN_WINDOW_DAYS = 30;
const TOP_PAGES_LIMIT = 10;
const BREAKDOWN_ROW_LIMIT = 8;

function dataApiClient(auth: BaseExternalAccountClient) {
  return google.analyticsdata({ version: "v1beta", auth });
}

async function runReport(
  client: analyticsdata_v1beta.Analyticsdata,
  propertyId: string,
  body: analyticsdata_v1beta.Schema$RunReportRequest,
) {
  const res = await client.properties.runReport({ property: `properties/${propertyId}`, requestBody: body });
  return res.data;
}

function firstMetricValue(report: analyticsdata_v1beta.Schema$RunReportResponse, index = 0): number {
  const value = report.rows?.[0]?.metricValues?.[index]?.value;
  return value ? Number(value) : 0;
}

function toBreakdownRows(report: analyticsdata_v1beta.Schema$RunReportResponse): DimensionBreakdownRow[] {
  return (report.rows ?? []).map((row) => ({
    label: row.dimensionValues?.[0]?.value || "(non défini)",
    value: Number(row.metricValues?.[0]?.value ?? 0),
  }));
}

async function fetchKpis(client: analyticsdata_v1beta.Analyticsdata, propertyId: string): Promise<SiteAnalyticsKpis> {
  const [today, last7, last30, last90] = await Promise.all([
    runReport(client, propertyId, { dateRanges: [{ startDate: "today", endDate: "today" }], metrics: [{ name: "activeUsers" }] }),
    runReport(client, propertyId, { dateRanges: [{ startDate: "7daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] }),
    runReport(client, propertyId, {
      dateRanges: [{ startDate: "30daysAgo", endDate: "today" }],
      metrics: [
        { name: "activeUsers" },
        { name: "sessions" },
        { name: "screenPageViews" },
        { name: "averageSessionDuration" },
        { name: "engagementRate" },
      ],
    }),
    runReport(client, propertyId, { dateRanges: [{ startDate: "90daysAgo", endDate: "today" }], metrics: [{ name: "activeUsers" }] }),
  ]);

  return {
    visitorsToday: firstMetricValue(today),
    visitors7d: firstMetricValue(last7),
    visitors30d: firstMetricValue(last30, 0),
    visitors90d: firstMetricValue(last90),
    activeUsers: firstMetricValue(last30, 0),
    sessions: firstMetricValue(last30, 1),
    pageviews: firstMetricValue(last30, 2),
    avgSessionDurationSeconds: firstMetricValue(last30, 3),
    engagementRate: firstMetricValue(last30, 4),
  };
}

async function fetchBreakdowns(client: analyticsdata_v1beta.Analyticsdata, propertyId: string): Promise<SiteAnalyticsBreakdowns> {
  const dateRanges = [{ startDate: `${BREAKDOWN_WINDOW_DAYS}daysAgo`, endDate: "today" }];

  const [breakdownReports, topPagesReport] = await Promise.all([
    Promise.all(
      BREAKDOWN_DIMENSIONS.map(({ dimension }) =>
        runReport(client, propertyId, {
          dateRanges,
          dimensions: [{ name: dimension }],
          metrics: [{ name: "activeUsers" }],
          orderBys: [{ metric: { metricName: "activeUsers" }, desc: true }],
          limit: String(BREAKDOWN_ROW_LIMIT),
        }),
      ),
    ),
    runReport(client, propertyId, {
      dateRanges,
      dimensions: [{ name: "pagePath" }],
      metrics: [{ name: "screenPageViews" }],
      orderBys: [{ metric: { metricName: "screenPageViews" }, desc: true }],
      limit: String(TOP_PAGES_LIMIT),
    }),
  ]);

  const result = {} as SiteAnalyticsBreakdowns;
  BREAKDOWN_DIMENSIONS.forEach(({ key }, i) => {
    result[key] = toBreakdownRows(breakdownReports[i]);
  });
  result.topPages = (topPagesReport.rows ?? []).map<TopPageRow>((row) => ({
    path: row.dimensionValues?.[0]?.value || "/",
    pageviews: Number(row.metricValues?.[0]?.value ?? 0),
  }));
  return result;
}

/** Uncached — always hits the GA4 Data API. Callers should go through
 * lib/site-analytics/cache.ts's getCachedTrafficAnalytics() instead of
 * calling this directly, to respect the 5-minute refresh budget. */
export async function fetchTrafficAnalyticsFromGa4(): Promise<SiteTrafficAnalytics> {
  const authResult = getGa4Auth();
  if (!authResult.ok) {
    return { kpis: null, breakdowns: null, unavailableReason: authResult.reason };
  }

  try {
    const client = dataApiClient(authResult.auth);
    const [kpis, breakdowns] = await Promise.all([fetchKpis(client, authResult.propertyId), fetchBreakdowns(client, authResult.propertyId)]);
    return { kpis, breakdowns, unavailableReason: null };
  } catch (err) {
    return {
      kpis: null,
      breakdowns: null,
      unavailableReason: err instanceof Error ? err.message : "GA4 Data API request failed.",
    };
  }
}
