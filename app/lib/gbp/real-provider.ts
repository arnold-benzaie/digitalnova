import { google } from "googleapis";
import { getValidAccessToken } from "@/lib/google/oauth";
import type { GbpDailyMetric, GbpLocation, GbpProvider, GbpReview } from "./types";

const VIEW_METRICS = [
  "BUSINESS_IMPRESSIONS_DESKTOP_MAPS",
  "BUSINESS_IMPRESSIONS_DESKTOP_SEARCH",
  "BUSINESS_IMPRESSIONS_MOBILE_MAPS",
  "BUSINESS_IMPRESSIONS_MOBILE_SEARCH",
];
const DAILY_METRICS = [...VIEW_METRICS, "CALL_CLICKS", "BUSINESS_DIRECTION_REQUESTS", "WEBSITE_CLICKS"];

const REVIEWS_NOT_AVAILABLE =
  "L'API des avis Google (My Business API v4) est restreinte par Google aux partenaires approuvés depuis 2024 — non disponible via l'accès Business Profile API standard, même avec un compte connecté.";

function authFor(accessToken: string) {
  const auth = new google.auth.OAuth2();
  auth.setCredentials({ access_token: accessToken });
  return auth;
}

function formatAddress(
  address?: { addressLines?: string[] | null; locality?: string | null; postalCode?: string | null } | null,
): string {
  if (!address) return "";
  const cityLine = [address.postalCode, address.locality].filter(Boolean).join(" ");
  return [...(address.addressLines ?? []), cityLine].filter(Boolean).join(", ");
}

/**
 * Real Google Business Profile integration (Account Management API +
 * Business Information API + Business Profile Performance API — see
 * lib/google/oauth.ts for the shared OAuth client). Reviews are
 * intentionally NOT implemented: Google restricted the My Business API v4
 * reviews endpoints in 2024 to a small allowlist of approved partners, and
 * the current `googleapis` package no longer ships typed bindings for it.
 * getReviews/replyToReview throw a clear error instead of silently
 * returning empty/mock data under a "real account connected" banner.
 */
export class RealGbpProvider implements GbpProvider {
  constructor(private readonly organizationId: string) {}

  private async auth() {
    const accessToken = await getValidAccessToken(this.organizationId);
    return authFor(accessToken);
  }

  async listLocations(): Promise<GbpLocation[]> {
    const auth = await this.auth();
    const accountManagement = google.mybusinessaccountmanagement({ version: "v1", auth });
    const { data: accountsData } = await accountManagement.accounts.list({});
    const accounts = accountsData.accounts ?? [];
    if (accounts.length === 0) return [];

    const businessInfo = google.mybusinessbusinessinformation({ version: "v1", auth });
    const result: GbpLocation[] = [];

    for (const account of accounts) {
      if (!account.name) continue;
      const { data: locationsData } = await businessInfo.accounts.locations.list({
        parent: account.name,
        readMask: "name,title,phoneNumbers,websiteUri,categories,storefrontAddress",
        pageSize: 100,
      });
      for (const location of locationsData.locations ?? []) {
        if (!location.name || !location.title) continue;
        result.push({
          googleLocationId: location.name,
          name: location.title,
          address: formatAddress(location.storefrontAddress),
          category: location.categories?.primaryCategory?.displayName ?? "",
          phone: location.phoneNumbers?.primaryPhone ?? undefined,
          websiteUrl: location.websiteUri ?? undefined,
        });
      }
    }
    return result;
  }

  async getMetrics(googleLocationId: string, days: number): Promise<GbpDailyMetric[]> {
    const auth = await this.auth();
    const performance = google.businessprofileperformance({ version: "v1", auth });

    const end = new Date();
    const start = new Date(end);
    start.setUTCDate(start.getUTCDate() - (days - 1));

    const { data } = await performance.locations.fetchMultiDailyMetricsTimeSeries({
      location: googleLocationId,
      dailyMetrics: DAILY_METRICS,
      "dailyRange.startDate.year": start.getUTCFullYear(),
      "dailyRange.startDate.month": start.getUTCMonth() + 1,
      "dailyRange.startDate.day": start.getUTCDate(),
      "dailyRange.endDate.year": end.getUTCFullYear(),
      "dailyRange.endDate.month": end.getUTCMonth() + 1,
      "dailyRange.endDate.day": end.getUTCDate(),
    });

    const byDate = new Map<string, GbpDailyMetric>();
    for (const series of data.multiDailyMetricTimeSeries ?? []) {
      for (const metricSeries of series.dailyMetricTimeSeries ?? []) {
        const metric = metricSeries.dailyMetric;
        if (!metric) continue;
        for (const point of metricSeries.timeSeries?.datedValues ?? []) {
          const { year, month, day } = point.date ?? {};
          if (!year || !month || !day) continue;
          const key = `${year}-${String(month).padStart(2, "0")}-${String(day).padStart(2, "0")}`;
          const value = Number(point.value ?? 0);
          const entry = byDate.get(key) ?? { date: key, views: 0, calls: 0, directionRequests: 0, websiteClicks: 0 };
          if (VIEW_METRICS.includes(metric)) entry.views += value;
          else if (metric === "CALL_CLICKS") entry.calls += value;
          else if (metric === "BUSINESS_DIRECTION_REQUESTS") entry.directionRequests += value;
          else if (metric === "WEBSITE_CLICKS") entry.websiteClicks += value;
          byDate.set(key, entry);
        }
      }
    }

    return [...byDate.values()].sort((a, b) => a.date.localeCompare(b.date));
  }

  async getReviews(): Promise<GbpReview[]> {
    throw new Error(REVIEWS_NOT_AVAILABLE);
  }

  async replyToReview(): Promise<void> {
    throw new Error(REVIEWS_NOT_AVAILABLE);
  }
}
