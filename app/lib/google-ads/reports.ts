import "server-only";
import { clearGoogleAdsAccountSelection } from "@/lib/google-ads/accounts";
import { isCustomerInaccessibleError, searchGoogleAds } from "@/lib/google-ads/client";
import { sanitizeGoogleAdsError } from "@/lib/google-ads/errors";
import { getGoogleAdsConnection, getValidGoogleAdsAccessToken, recordGoogleAdsSyncResult } from "@/lib/google-ads/tokens";

/** The 4 presets the mission asks for — exact GAQL DURING literals,
 * verified against Google's own date-ranges documentation (not guessed).
 * "Plage personnalisée" is intentionally NOT implemented in V1 — see the
 * Étape 2 report. */
export const GOOGLE_ADS_DATE_RANGES = ["LAST_7_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH"] as const;
export type GoogleAdsDateRange = (typeof GOOGLE_ADS_DATE_RANGES)[number];

export function isGoogleAdsDateRange(value: string): value is GoogleAdsDateRange {
  return (GOOGLE_ADS_DATE_RANGES as readonly string[]).includes(value);
}

export type GoogleAdsAccountSummary = {
  impressions: number;
  clicks: number;
  costMicros: string;
  ctr: number;
  averageCpcMicros: string;
  conversions: number;
  conversionsValue: number;
};

export type GoogleAdsCampaign = {
  id: string;
  name: string;
  status: string;
  channelType: string;
  budgetMicros: string | null;
  impressions: number;
  clicks: number;
  costMicros: string;
  ctr: number;
  averageCpcMicros: string;
  conversions: number;
};

function summaryQuery(range: GoogleAdsDateRange): string {
  return `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date DURING ${range}
  `;
}

function campaignsQuery(range: GoogleAdsDateRange): string {
  return `
    SELECT
      campaign.id,
      campaign.name,
      campaign.status,
      campaign.advertising_channel_type,
      campaign_budget.amount_micros,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions
    FROM campaign
    WHERE segments.date DURING ${range}
    ORDER BY metrics.cost_micros DESC
  `;
}

/** Parses one GAQL result row's `metrics.*` fields into the summary shape
 * — extracted as a pure function so the parsing itself (not just the
 * network call) is unit-testable. */
export function parseAccountSummaryRow(row: Record<string, unknown> | undefined): GoogleAdsAccountSummary {
  const metrics = (row?.metrics ?? {}) as Record<string, unknown>;
  return {
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    costMicros: String(metrics.costMicros ?? "0"),
    ctr: Number(metrics.ctr ?? 0),
    averageCpcMicros: String(metrics.averageCpc ?? "0"),
    conversions: Number(metrics.conversions ?? 0),
    conversionsValue: Number(metrics.conversionsValue ?? 0),
  };
}

export function parseCampaignRow(row: Record<string, unknown>): GoogleAdsCampaign {
  const campaign = (row.campaign ?? {}) as Record<string, unknown>;
  const budget = (row.campaignBudget ?? {}) as Record<string, unknown>;
  const metrics = (row.metrics ?? {}) as Record<string, unknown>;
  return {
    id: String(campaign.id ?? ""),
    name: typeof campaign.name === "string" ? campaign.name : "",
    status: typeof campaign.status === "string" ? campaign.status : "UNKNOWN",
    channelType: typeof campaign.advertisingChannelType === "string" ? campaign.advertisingChannelType : "UNKNOWN",
    budgetMicros: budget.amountMicros !== undefined ? String(budget.amountMicros) : null,
    impressions: Number(metrics.impressions ?? 0),
    clicks: Number(metrics.clicks ?? 0),
    costMicros: String(metrics.costMicros ?? "0"),
    ctr: Number(metrics.ctr ?? 0),
    averageCpcMicros: String(metrics.averageCpc ?? "0"),
    conversions: Number(metrics.conversions ?? 0),
  };
}

export type GoogleAdsPerformanceReport = { summary: GoogleAdsAccountSummary; campaigns: GoogleAdsCampaign[] };

/**
 * Fetches the account-level summary AND the campaign list in exactly 2
 * Google Ads API calls (never one call per campaign) — matches the
 * "regrouper les métriques, éviter les N+1" quota discipline for Basic
 * Access. Requires an account to already be selected (see
 * lib/google-ads/accounts.ts::selectGoogleAdsAccount()).
 */
export async function getGoogleAdsPerformanceReport(organizationId: string, range: GoogleAdsDateRange): Promise<GoogleAdsPerformanceReport> {
  const connection = await getGoogleAdsConnection(organizationId);
  if (!connection?.customerId) {
    throw new Error("Aucun compte Google Ads sélectionné pour cette organisation.");
  }

  const accessToken = await getValidGoogleAdsAccessToken(organizationId);

  try {
    // pageSize: null — confirmed against a real, enabled account that
    // Google Ads API rejects page_size with PAGE_SIZE_NOT_SUPPORTED for
    // both of these queries (FROM customer, FROM campaign), not just
    // customer_client (see lib/google-ads/accounts.ts's own discovery
    // query, fixed the same way). Pagination itself still works without
    // it — searchGoogleAds()'s loop is driven by Google's own
    // nextPageToken in the response, not by the request's page_size.
    const [summaryRows, campaignRows] = await Promise.all([
      searchGoogleAds({ accessToken, customerId: connection.customerId, loginCustomerId: connection.loginCustomerId, query: summaryQuery(range), pageSize: null }),
      searchGoogleAds({ accessToken, customerId: connection.customerId, loginCustomerId: connection.loginCustomerId, query: campaignsQuery(range), pageSize: null }),
    ]);
    await recordGoogleAdsSyncResult(organizationId, null);
    return {
      summary: parseAccountSummaryRow(summaryRows[0]),
      campaigns: campaignRows.map(parseCampaignRow),
    };
  } catch (err) {
    await recordGoogleAdsSyncResult(organizationId, sanitizeGoogleAdsError(err).message);
    // The remembered selection is only ever dropped on this ONE specific,
    // unambiguous signal from Google itself — never on a transient/quota/
    // network error, which must stay a retryable "réessayez plus tard".
    // The caller (app/dashboard/google-ads/page.tsx) still receives the
    // original error and decides how to route the user; clearing here
    // (rather than in the page) keeps this the single place that knows
    // what "no longer accessible" actually means for a Google Ads call.
    if (isCustomerInaccessibleError(err)) {
      await clearGoogleAdsAccountSelection(organizationId);
    }
    throw err;
  }
}
