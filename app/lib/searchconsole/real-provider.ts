import { google } from "googleapis";
import { getValidAccessToken, GOOGLE_API_REQUEST_TIMEOUT_MS, GAXIOS_DEFAULT_RETRY_METHODS } from "@/lib/google/oauth";
import type { SearchConsoleDailyMetric, SearchConsoleProperty, SearchConsoleProvider } from "./types";

function authFor(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

// P1 network audit (2026-10): sites.list is a real GET (verified against
// node_modules/googleapis/build/src/apis/searchconsole/v1.js) — retry is
// already `true` by default for it via googleapis-common's shared
// createAPIRequest wrapper; explicit here only for documentation, not a
// behavior change.
const LIST_REQUEST_OPTIONS = { timeout: GOOGLE_API_REQUEST_TIMEOUT_MS, retry: true };

// searchanalytics.query is a real POST (verified in the same generated
// client source) carrying no side effect — a pure read, safe to retry on
// a transient failure. POST is excluded from gaxios's own default
// retryable-method list (see GAXIOS_DEFAULT_RETRY_METHODS's own docs in
// lib/google/oauth.ts), so it must be added explicitly for THIS verified
// case only — never applied blanket to every POST call in this codebase.
const QUERY_REQUEST_OPTIONS = {
  timeout: GOOGLE_API_REQUEST_TIMEOUT_MS,
  retry: true,
  retryConfig: { httpMethodsToRetry: [...GAXIOS_DEFAULT_RETRY_METHODS, "POST"] },
};

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
    const { data } = await searchconsole.sites.list({}, LIST_REQUEST_OPTIONS);
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

    const { data } = await searchconsole.searchanalytics.query(
      {
        siteUrl,
        requestBody: {
          startDate: formatDate(start),
          endDate: formatDate(end),
          dimensions: ["date"],
          rowLimit: days,
        },
      },
      QUERY_REQUEST_OPTIONS,
    );

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
