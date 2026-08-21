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

export type GoogleAdsDailyMetric = {
  date: string; // YYYY-MM-DD, as segments.date returns it
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

export type GoogleAdsTrendDirection = "up" | "down" | "flat";
export type GoogleAdsTrend = { direction: GoogleAdsTrendDirection; percent: number | null };

export type GoogleAdsSummaryTrends = {
  impressions: GoogleAdsTrend;
  clicks: GoogleAdsTrend;
  costMicros: GoogleAdsTrend;
  ctr: GoogleAdsTrend;
  averageCpcMicros: GoogleAdsTrend;
  conversions: GoogleAdsTrend;
  conversionsValue: GoogleAdsTrend;
};

export type GoogleAdsCampaignBreakdownMetric = "costMicros" | "conversions" | "clicks";

export type GoogleAdsAnalyticsReport = {
  summary: GoogleAdsAccountSummary;
  trends: GoogleAdsSummaryTrends;
  dailySeries: GoogleAdsDailyMetric[];
  campaigns: GoogleAdsCampaign[];
};

// ---- GAQL query builders ------------------------------------------------

/** Replaces the old aggregate-only summary query — selecting segments.date
 * makes Google return one row PER DAY, which already contains everything
 * the old single-row aggregate had (see aggregateFromDailyRows() below) —
 * one call now serves both the KPI totals and the time-series chart. */
function dailySeriesQuery(range: GoogleAdsDateRange): string {
  return `
    SELECT
      segments.date,
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.ctr,
      metrics.average_cpc,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date DURING ${range}
    ORDER BY segments.date ASC
  `;
}

/** Google Ads has no DURING keyword for "the period before this one" — the
 * comparison window's exact calendar dates are computed by
 * computePreviousPeriodRange() and passed here as a literal BETWEEN
 * clause. Aggregate only (no segments.date): nothing charts the previous
 * period, only its totals are needed for the trend comparison. */
function previousPeriodQuery(start: string, end: string): string {
  return `
    SELECT
      metrics.impressions,
      metrics.clicks,
      metrics.cost_micros,
      metrics.conversions,
      metrics.conversions_value
    FROM customer
    WHERE segments.date BETWEEN '${start}' AND '${end}'
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

// ---- date-range math (pure, unit-tested) --------------------------------

function formatDateOnly(date: Date): string {
  return date.toISOString().slice(0, 10);
}

function addDaysUTC(date: Date, days: number): Date {
  const d = new Date(date);
  d.setUTCDate(d.getUTCDate() + days);
  return d;
}

function lastDayOfMonthUTC(date: Date): Date {
  // Day 0 of the following month is the last day of `date`'s own month.
  return new Date(Date.UTC(date.getUTCFullYear(), date.getUTCMonth() + 1, 0));
}

/**
 * The exact comparison window for each preset, verified against Google's
 * own DURING semantics (LAST_7_DAYS/LAST_30_DAYS exclude today; THIS_MONTH
 * runs from the 1st through today; LAST_MONTH is the full prior calendar
 * month):
 *   - LAST_7_DAYS  -> the 7 days immediately before the current 7.
 *   - LAST_30_DAYS -> the 30 days immediately before the current 30.
 *   - THIS_MONTH   -> the SAME number of elapsed days, starting the 1st of
 *     the previous month — never the previous month in full, which would
 *     compare a partial month to a complete one and bias every trend
 *     toward "down". Capped at that month's own last day (e.g. comparing
 *     March 31 to February never overflows into March).
 *   - LAST_MONTH   -> the full calendar month before that.
 * `today` is a parameter (not read internally) so this stays pure and
 * exactly reproducible in tests.
 */
export function computePreviousPeriodRange(range: GoogleAdsDateRange, today: Date): { start: string; end: string } {
  switch (range) {
    case "LAST_7_DAYS":
      return { start: formatDateOnly(addDaysUTC(today, -14)), end: formatDateOnly(addDaysUTC(today, -8)) };
    case "LAST_30_DAYS":
      return { start: formatDateOnly(addDaysUTC(today, -60)), end: formatDateOnly(addDaysUTC(today, -31)) };
    case "THIS_MONTH": {
      const daysElapsed = today.getUTCDate();
      const prevMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const prevMonthLastDay = lastDayOfMonthUTC(prevMonthStart);
      const candidateEnd = addDaysUTC(prevMonthStart, daysElapsed - 1);
      const end = candidateEnd.getTime() > prevMonthLastDay.getTime() ? prevMonthLastDay : candidateEnd;
      return { start: formatDateOnly(prevMonthStart), end: formatDateOnly(end) };
    }
    case "LAST_MONTH": {
      const lastMonthStart = new Date(Date.UTC(today.getUTCFullYear(), today.getUTCMonth() - 1, 1));
      const start = new Date(Date.UTC(lastMonthStart.getUTCFullYear(), lastMonthStart.getUTCMonth() - 1, 1));
      return { start: formatDateOnly(start), end: formatDateOnly(lastDayOfMonthUTC(start)) };
    }
  }
}

// ---- trend math (pure, unit-tested) -------------------------------------

/** previous === 0 is handled explicitly, never as a division: a genuine
 * increase from zero has no finite percentage (never Infinity/NaN), and
 * previous === current === 0 is "flat", not "up". Below FLAT_THRESHOLD_PERCENT
 * counts as flat too, so a +0.001% rounding artifact never reads as a real
 * trend arrow. */
const FLAT_THRESHOLD_PERCENT = 0.05;

export function computeTrend(current: number, previous: number): GoogleAdsTrend {
  if (previous === 0) {
    if (current === 0) return { direction: "flat", percent: null };
    return { direction: "up", percent: null };
  }
  const percent = ((current - previous) / previous) * 100;
  if (Math.abs(percent) < FLAT_THRESHOLD_PERCENT) return { direction: "flat", percent };
  return { direction: percent > 0 ? "up" : "down", percent };
}

export function computeSummaryTrends(current: GoogleAdsAccountSummary, previous: GoogleAdsAccountSummary): GoogleAdsSummaryTrends {
  return {
    impressions: computeTrend(current.impressions, previous.impressions),
    clicks: computeTrend(current.clicks, previous.clicks),
    costMicros: computeTrend(Number(current.costMicros), Number(previous.costMicros)),
    ctr: computeTrend(current.ctr, previous.ctr),
    averageCpcMicros: computeTrend(Number(current.averageCpcMicros), Number(previous.averageCpcMicros)),
    conversions: computeTrend(current.conversions, previous.conversions),
    conversionsValue: computeTrend(current.conversionsValue, previous.conversionsValue),
  };
}

// ---- row parsing (pure, unit-tested) ------------------------------------

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

export function parseDailyRow(row: Record<string, unknown>): GoogleAdsDailyMetric {
  const segments = (row.segments ?? {}) as Record<string, unknown>;
  const metrics = (row.metrics ?? {}) as Record<string, unknown>;
  return {
    date: typeof segments.date === "string" ? segments.date : "",
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

/** Derives the period aggregate from the daily rows — replaces the old
 * separate aggregate query. `ctr`/`averageCpcMicros` are RATIOS: summing
 * or averaging each day's own ratio would be wrong (e.g. a day with 2
 * impressions and 100% CTR would skew the period average as much as a day
 * with 10,000 impressions and a 2% CTR). Recomputed here from the summed
 * base metrics instead: ctr = Σclicks/Σimpressions, avgCpc = Σcost/Σclicks.
 * costMicros is summed as BigInt to preserve int64 precision — same
 * discipline as parseAccountSummaryRow's own costMicros handling. */
export function aggregateFromDailyRows(rows: GoogleAdsDailyMetric[]): GoogleAdsAccountSummary {
  let impressions = 0;
  let clicks = 0;
  let costMicros = BigInt(0);
  let conversions = 0;
  let conversionsValue = 0;
  for (const row of rows) {
    impressions += row.impressions;
    clicks += row.clicks;
    costMicros += BigInt(row.costMicros || "0");
    conversions += row.conversions;
    conversionsValue += row.conversionsValue;
  }
  return {
    impressions,
    clicks,
    costMicros: costMicros.toString(),
    ctr: impressions > 0 ? clicks / impressions : 0,
    averageCpcMicros: clicks > 0 ? (costMicros / BigInt(clicks)).toString() : "0",
    conversions,
    conversionsValue,
  };
}

/** {label, value} rows for the campaign breakdown chart — reuses the SAME
 * campaign rows already fetched for the table (no extra GAQL call). Zero-
 * value entries are dropped so a donut/bar chart never renders an
 * invisible slice for a campaign with no activity in the period. */
export function campaignBreakdown(campaigns: GoogleAdsCampaign[], metric: GoogleAdsCampaignBreakdownMetric): { label: string; value: number }[] {
  const valueOf = (c: GoogleAdsCampaign): number => {
    if (metric === "costMicros") return Number(c.costMicros) / 1_000_000;
    if (metric === "conversions") return c.conversions;
    return c.clicks;
  };
  return campaigns
    .map((c) => ({ label: c.name || c.id, value: valueOf(c) }))
    .filter((row) => row.value > 0)
    .sort((a, b) => b.value - a.value);
}

/**
 * Fetches the daily time series (which already contains the current-period
 * aggregate), the previous-period aggregate, and the campaign list in
 * exactly 3 Google Ads API calls (never one call per campaign, never a
 * separate 4th call for the old aggregate-only query it replaces) —
 * matches the "regrouper les métriques, éviter les N+1" quota discipline
 * for Basic Access. Requires an account to already be selected (see
 * lib/google-ads/accounts.ts::selectGoogleAdsAccount()).
 */
export async function getGoogleAdsAnalyticsReport(organizationId: string, range: GoogleAdsDateRange): Promise<GoogleAdsAnalyticsReport> {
  const connection = await getGoogleAdsConnection(organizationId);
  if (!connection?.customerId) {
    throw new Error("Aucun compte Google Ads sélectionné pour cette organisation.");
  }

  const accessToken = await getValidGoogleAdsAccessToken(organizationId);
  const { start, end } = computePreviousPeriodRange(range, new Date());

  try {
    // pageSize: null — confirmed against a real, enabled account that
    // Google Ads API rejects page_size with PAGE_SIZE_NOT_SUPPORTED for
    // FROM customer and FROM campaign alike (not just customer_client —
    // see lib/google-ads/accounts.ts's discovery query, fixed the same
    // way). Pagination itself still works without it — searchGoogleAds()'s
    // loop is driven by Google's own nextPageToken in the response, not
    // by the request's page_size.
    const [dailyRows, previousRows, campaignRows] = await Promise.all([
      searchGoogleAds({ accessToken, customerId: connection.customerId, loginCustomerId: connection.loginCustomerId, query: dailySeriesQuery(range), pageSize: null }),
      searchGoogleAds({ accessToken, customerId: connection.customerId, loginCustomerId: connection.loginCustomerId, query: previousPeriodQuery(start, end), pageSize: null }),
      searchGoogleAds({ accessToken, customerId: connection.customerId, loginCustomerId: connection.loginCustomerId, query: campaignsQuery(range), pageSize: null }),
    ]);
    await recordGoogleAdsSyncResult(organizationId, null);

    const dailySeries = dailyRows.map(parseDailyRow);
    const summary = aggregateFromDailyRows(dailySeries);
    const previousSummary = parseAccountSummaryRow(previousRows[0]);

    return {
      summary,
      trends: computeSummaryTrends(summary, previousSummary),
      dailySeries,
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
