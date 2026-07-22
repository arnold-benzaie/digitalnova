import { google } from "googleapis";
import { getValidAccessToken } from "@/lib/google/oauth";
import type { AnalyticsDailyMetric, AnalyticsProperty, AnalyticsProvider } from "./types";

function authFor(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/** GA4 "date" dimension comes back as YYYYMMDD with no separators. */
function parseGa4Date(raw: string): string | null {
  if (raw.length !== 8) return null;
  return `${raw.slice(0, 4)}-${raw.slice(4, 6)}-${raw.slice(6, 8)}`;
}

/**
 * Real Google Analytics GA4 integration (analytics.readonly scope, see
 * lib/google/oauth.ts). Two separate Google APIs are involved: the
 * Analytics Admin API (to discover which GA4 properties the connected
 * account can see) and the Analytics Data API (to query daily metrics for
 * a known property) — both must be enabled in Google Cloud for this to
 * work. No mock provider.
 */
export class RealAnalyticsProvider implements AnalyticsProvider {
  constructor(private readonly organizationId: string) {}

  private async auth() {
    const accessToken = await getValidAccessToken(this.organizationId);
    return authFor(accessToken);
  }

  async listProperties(): Promise<AnalyticsProperty[]> {
    const auth = await this.auth();
    const analyticsAdmin = google.analyticsadmin({ version: "v1beta", auth });
    const { data } = await analyticsAdmin.accountSummaries.list({});

    const result: AnalyticsProperty[] = [];
    for (const account of data.accountSummaries ?? []) {
      for (const property of account.propertySummaries ?? []) {
        if (property.property && property.displayName) {
          result.push({ propertyResourceName: property.property, displayName: property.displayName });
        }
      }
    }
    return result;
  }

  async getMetrics(propertyResourceName: string, days: number): Promise<AnalyticsDailyMetric[]> {
    const auth = await this.auth();
    const analyticsData = google.analyticsdata({ version: "v1beta", auth });

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const { data } = await analyticsData.properties.runReport({
      property: propertyResourceName,
      requestBody: {
        dateRanges: [{ startDate: formatDate(start), endDate: formatDate(end) }],
        dimensions: [{ name: "date" }],
        metrics: [{ name: "sessions" }, { name: "activeUsers" }, { name: "screenPageViews" }, { name: "bounceRate" }],
      },
    });

    const result: AnalyticsDailyMetric[] = [];
    for (const row of data.rows ?? []) {
      const rawDate = row.dimensionValues?.[0]?.value;
      const date = rawDate ? parseGa4Date(rawDate) : null;
      if (!date) continue;
      const [sessions, activeUsers, pageviews, bounceRate] = (row.metricValues ?? []).map((m) => Number(m.value ?? 0));
      result.push({
        date,
        sessions: Math.round(sessions ?? 0),
        activeUsers: Math.round(activeUsers ?? 0),
        pageviews: Math.round(pageviews ?? 0),
        bounceRate: bounceRate ?? 0,
      });
    }
    return result;
  }
}
