import { google } from "googleapis";
import { getValidAccessToken } from "@/lib/google/oauth";
import type { SearchConsoleDailyMetric, SearchConsoleProperty, SearchConsoleProvider } from "./types";

function authFor(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function formatDate(d: Date): string {
  return d.toISOString().slice(0, 10);
}

/**
 * Real Google Search Console integration (webmasters.readonly scope, see
 * lib/google/oauth.ts). No mock provider — Search Console requires no
 * special Google approval beyond the standard OAuth consent, unlike GBP's
 * reviews API.
 */
export class RealSearchConsoleProvider implements SearchConsoleProvider {
  constructor(private readonly organizationId: string) {}

  private async auth() {
    const accessToken = await getValidAccessToken(this.organizationId);
    return authFor(accessToken);
  }

  async listProperties(): Promise<SearchConsoleProperty[]> {
    const auth = await this.auth();
    const searchconsole = google.searchconsole({ version: "v1", auth });
    const { data } = await searchconsole.sites.list({});
    return (data.siteEntry ?? [])
      .filter((s) => s.siteUrl)
      .map((s) => ({ siteUrl: s.siteUrl as string, permissionLevel: s.permissionLevel ?? null }));
  }

  async getPerformance(siteUrl: string, days: number): Promise<SearchConsoleDailyMetric[]> {
    const auth = await this.auth();
    const searchconsole = google.searchconsole({ version: "v1", auth });

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const { data } = await searchconsole.searchanalytics.query({
      siteUrl,
      requestBody: {
        startDate: formatDate(start),
        endDate: formatDate(end),
        dimensions: ["date"],
        rowLimit: days,
      },
    });

    return (data.rows ?? [])
      .filter((row) => row.keys?.[0])
      .map((row) => ({
        date: row.keys![0] as string,
        clicks: Math.round(row.clicks ?? 0),
        impressions: Math.round(row.impressions ?? 0),
        ctr: row.ctr ?? 0,
        position: row.position ?? 0,
      }));
  }
}
