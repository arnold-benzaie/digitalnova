// Pure unit tests for date-range validation and GAQL result parsing — no
// DB, no network. Run with: npx tsx --test --experimental-test-module-mocks lib/google-ads/reports.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
// reports.ts imports lib/google-ads/tokens.ts, which imports @/db — stub it
// out so this file can load without a real DATABASE_URL. None of the pure
// functions tested here (date-range validation, GAQL row parsing) touch it.
mock.module("@/db", { namedExports: { db: {} } });

const {
  GOOGLE_ADS_DATE_RANGES,
  isGoogleAdsDateRange,
  parseAccountSummaryRow,
  parseCampaignRow,
  parseDailyRow,
  aggregateFromDailyRows,
  computePreviousPeriodRange,
  computeTrend,
  computeSummaryTrends,
  campaignBreakdown,
} = await import("./reports.ts");

test("GOOGLE_ADS_DATE_RANGES is exactly the 4 presets the mission asked for, using Google's own literal spelling", () => {
  assert.deepEqual([...GOOGLE_ADS_DATE_RANGES], ["LAST_7_DAYS", "LAST_30_DAYS", "THIS_MONTH", "LAST_MONTH"]);
});

test("isGoogleAdsDateRange: accepts only the 4 known presets", () => {
  for (const r of GOOGLE_ADS_DATE_RANGES) assert.equal(isGoogleAdsDateRange(r), true);
  for (const bad of ["LAST_14_DAYS", "TODAY", "custom", "", "last_30_days"]) {
    assert.equal(isGoogleAdsDateRange(bad), false, `"${bad}" must not be accepted — never let an unrecognized value reach the GAQL query`);
  }
});

test("parseAccountSummaryRow: extracts every metric field with correct types", () => {
  const row = {
    metrics: { impressions: "1200", clicks: "45", costMicros: "3450000", ctr: 0.0375, averageCpc: "76666", conversions: 3.5, conversionsValue: 210.5 },
  };
  assert.deepEqual(parseAccountSummaryRow(row), {
    impressions: 1200,
    clicks: 45,
    costMicros: "3450000",
    ctr: 0.0375,
    averageCpcMicros: "76666",
    conversions: 3.5,
    conversionsValue: 210.5,
  });
});

test("parseAccountSummaryRow: a missing/undefined row (e.g. zero activity in the period) never throws — returns all zeros", () => {
  assert.deepEqual(parseAccountSummaryRow(undefined), {
    impressions: 0,
    clicks: 0,
    costMicros: "0",
    ctr: 0,
    averageCpcMicros: "0",
    conversions: 0,
    conversionsValue: 0,
  });
});

test("parseAccountSummaryRow: keeps costMicros as a string (int64 precision), never coerces it to a lossy float", () => {
  const huge = "9007199254740993"; // beyond Number.MAX_SAFE_INTEGER
  const row = { metrics: { costMicros: huge } };
  assert.equal(parseAccountSummaryRow(row).costMicros, huge);
});

test("parseCampaignRow: extracts campaign + budget + metrics fields", () => {
  const row = {
    campaign: { id: "123456789", name: "Campagne printemps", status: "ENABLED", advertisingChannelType: "SEARCH" },
    campaignBudget: { amountMicros: "50000000" },
    metrics: { impressions: "800", clicks: "20", costMicros: "1500000", ctr: 0.025, averageCpc: "75000", conversions: 2 },
  };
  assert.deepEqual(parseCampaignRow(row), {
    id: "123456789",
    name: "Campagne printemps",
    status: "ENABLED",
    channelType: "SEARCH",
    budgetMicros: "50000000",
    impressions: 800,
    clicks: 20,
    costMicros: "1500000",
    ctr: 0.025,
    averageCpcMicros: "75000",
    conversions: 2,
  });
});

test("parseCampaignRow: a campaign with no budget resource (e.g. shared budget edge case) never throws — budgetMicros is null", () => {
  const row = { campaign: { id: "1", name: "X", status: "PAUSED", advertisingChannelType: "DISPLAY" }, metrics: {} };
  const parsed = parseCampaignRow(row);
  assert.equal(parsed.budgetMicros, null);
  assert.equal(parsed.impressions, 0);
});

// ---- parseDailyRow -------------------------------------------------------

test("parseDailyRow: extracts segments.date alongside every metric field", () => {
  const row = {
    segments: { date: "2026-08-15" },
    metrics: { impressions: "300", clicks: "12", costMicros: "900000", ctr: 0.04, averageCpc: "75000", conversions: 1, conversionsValue: 40 },
  };
  assert.deepEqual(parseDailyRow(row), {
    date: "2026-08-15",
    impressions: 300,
    clicks: 12,
    costMicros: "900000",
    ctr: 0.04,
    averageCpcMicros: "75000",
    conversions: 1,
    conversionsValue: 40,
  });
});

test("parseDailyRow: a row with no segments object never throws — date is an empty string, not undefined/null", () => {
  assert.equal(parseDailyRow({ metrics: {} }).date, "");
});

// ---- aggregateFromDailyRows ----------------------------------------------

test("aggregateFromDailyRows: sums base metrics, recomputes ctr/averageCpc as ratios of the SUMS (never averaging per-day ratios)", () => {
  const rows = [
    { date: "2026-08-01", impressions: 100, clicks: 10, costMicros: "500000", ctr: 0.1, averageCpcMicros: "50000", conversions: 1, conversionsValue: 20 },
    { date: "2026-08-02", impressions: 900, clicks: 9, costMicros: "450000", ctr: 0.01, averageCpcMicros: "50000", conversions: 0.5, conversionsValue: 15 },
  ];
  const aggregate = aggregateFromDailyRows(rows);
  assert.equal(aggregate.impressions, 1000);
  assert.equal(aggregate.clicks, 19);
  assert.equal(aggregate.costMicros, "950000");
  assert.equal(aggregate.conversions, 1.5);
  assert.equal(aggregate.conversionsValue, 35);
  // Naively averaging the two days' own ctr (0.1, 0.01) would give 0.055 —
  // wrong. The correct period ctr is total clicks / total impressions.
  assert.equal(aggregate.ctr, 19 / 1000);
  assert.equal(aggregate.averageCpcMicros, String(Math.floor(950000 / 19)));
});

test("aggregateFromDailyRows: an empty array (account/campaign with no activity in the period) never throws — all zeros", () => {
  assert.deepEqual(aggregateFromDailyRows([]), {
    impressions: 0,
    clicks: 0,
    costMicros: "0",
    ctr: 0,
    averageCpcMicros: "0",
    conversions: 0,
    conversionsValue: 0,
  });
});

test("aggregateFromDailyRows: costMicros is summed as BigInt — precision preserved beyond Number.MAX_SAFE_INTEGER", () => {
  const rows = [
    { date: "2026-08-01", impressions: 0, clicks: 0, costMicros: "9007199254740993", ctr: 0, averageCpcMicros: "0", conversions: 0, conversionsValue: 0 },
    { date: "2026-08-02", impressions: 0, clicks: 0, costMicros: "1", ctr: 0, averageCpcMicros: "0", conversions: 0, conversionsValue: 0 },
  ];
  assert.equal(aggregateFromDailyRows(rows).costMicros, "9007199254740994");
});

// ---- computePreviousPeriodRange -------------------------------------------

test("computePreviousPeriodRange: LAST_7_DAYS -> the 7 days immediately before the current 7", () => {
  assert.deepEqual(computePreviousPeriodRange("LAST_7_DAYS", new Date(Date.UTC(2026, 7, 22))), { start: "2026-08-08", end: "2026-08-14" });
});

test("computePreviousPeriodRange: LAST_30_DAYS -> the 30 days immediately before the current 30", () => {
  assert.deepEqual(computePreviousPeriodRange("LAST_30_DAYS", new Date(Date.UTC(2026, 7, 22))), { start: "2026-06-23", end: "2026-07-22" });
});

test("computePreviousPeriodRange: THIS_MONTH -> same number of elapsed days, starting the 1st of the previous month", () => {
  assert.deepEqual(computePreviousPeriodRange("THIS_MONTH", new Date(Date.UTC(2026, 7, 22))), { start: "2026-07-01", end: "2026-07-22" });
});

test("computePreviousPeriodRange: THIS_MONTH caps at the previous month's own last day — never overflows into the month after (e.g. March 31 vs a 28-day February)", () => {
  assert.deepEqual(computePreviousPeriodRange("THIS_MONTH", new Date(Date.UTC(2026, 2, 31))), { start: "2026-02-01", end: "2026-02-28" });
});

test("computePreviousPeriodRange: THIS_MONTH crosses a year boundary correctly (January -> previous December)", () => {
  assert.deepEqual(computePreviousPeriodRange("THIS_MONTH", new Date(Date.UTC(2026, 0, 5))), { start: "2025-12-01", end: "2025-12-05" });
});

test("computePreviousPeriodRange: LAST_MONTH -> the full calendar month before the current LAST_MONTH", () => {
  assert.deepEqual(computePreviousPeriodRange("LAST_MONTH", new Date(Date.UTC(2026, 7, 22))), { start: "2026-06-01", end: "2026-06-30" });
});

test("computePreviousPeriodRange: LAST_MONTH crosses a year boundary correctly (January -> previous November)", () => {
  assert.deepEqual(computePreviousPeriodRange("LAST_MONTH", new Date(Date.UTC(2026, 0, 15))), { start: "2025-11-01", end: "2025-11-30" });
});

// ---- computeTrend / computeSummaryTrends ----------------------------------

test("computeTrend: a real increase computes the correct positive percent", () => {
  assert.deepEqual(computeTrend(120, 100), { direction: "up", percent: 20 });
});

test("computeTrend: a real decrease computes the correct negative percent", () => {
  assert.deepEqual(computeTrend(80, 100), { direction: "down", percent: -20 });
});

test("computeTrend: previous === 0 and current === 0 -> flat, percent null (never a division by zero, never NaN/Infinity)", () => {
  assert.deepEqual(computeTrend(0, 0), { direction: "flat", percent: null });
});

test("computeTrend: previous === 0 and current > 0 -> up, percent null (a finite percentage from zero doesn't exist)", () => {
  const trend = computeTrend(50, 0);
  assert.equal(trend.direction, "up");
  assert.equal(trend.percent, null);
});

test("computeTrend: a change smaller than the flat threshold reads as flat, not a spurious arrow", () => {
  const trend = computeTrend(100.01, 100);
  assert.equal(trend.direction, "flat");
});

test("computeSummaryTrends: computes one trend per KPI, string micros fields compared numerically", () => {
  const current = { impressions: 200, clicks: 20, costMicros: "1100000", ctr: 0.1, averageCpcMicros: "55000", conversions: 4, conversionsValue: 80 };
  const previous = { impressions: 100, clicks: 10, costMicros: "1000000", ctr: 0.1, averageCpcMicros: "100000", conversions: 2, conversionsValue: 40 };
  const trends = computeSummaryTrends(current, previous);
  assert.equal(trends.impressions.direction, "up");
  assert.equal(trends.impressions.percent, 100);
  assert.equal(trends.costMicros.direction, "up");
  assert.equal(trends.costMicros.percent, 10);
  assert.equal(trends.averageCpcMicros.direction, "down");
  assert.equal(trends.averageCpcMicros.percent, -45);
});

// ---- campaignBreakdown -----------------------------------------------------

const SAMPLE_CAMPAIGNS = [
  { id: "1", name: "Campagne A", status: "ENABLED", channelType: "SEARCH", budgetMicros: null, impressions: 100, clicks: 10, costMicros: "5000000", ctr: 0.1, averageCpcMicros: "500000", conversions: 3 },
  { id: "2", name: "Campagne B", status: "ENABLED", channelType: "DISPLAY", budgetMicros: null, impressions: 50, clicks: 2, costMicros: "1000000", ctr: 0.04, averageCpcMicros: "500000", conversions: 0 },
  { id: "3", name: "Campagne sans activité", status: "PAUSED", channelType: "SEARCH", budgetMicros: null, impressions: 0, clicks: 0, costMicros: "0", ctr: 0, averageCpcMicros: "0", conversions: 0 },
];

test("campaignBreakdown: cost metric — converts micros to full currency units, sorted descending, zero-activity campaigns dropped", () => {
  const rows = campaignBreakdown(SAMPLE_CAMPAIGNS, "costMicros");
  assert.deepEqual(rows, [
    { label: "Campagne A", value: 5 },
    { label: "Campagne B", value: 1 },
  ]);
});

test("campaignBreakdown: clicks metric, zero dropped", () => {
  assert.deepEqual(campaignBreakdown(SAMPLE_CAMPAIGNS, "clicks"), [
    { label: "Campagne A", value: 10 },
    { label: "Campagne B", value: 2 },
  ]);
});

test("campaignBreakdown: conversions metric — a campaign with clicks but zero conversions is dropped from THIS breakdown specifically", () => {
  assert.deepEqual(campaignBreakdown(SAMPLE_CAMPAIGNS, "conversions"), [{ label: "Campagne A", value: 3 }]);
});

test("campaignBreakdown: an account with no campaigns at all returns an empty array, never throws", () => {
  assert.deepEqual(campaignBreakdown([], "costMicros"), []);
});

test("campaignBreakdown: falls back to the campaign id when the name is empty", () => {
  const rows = campaignBreakdown([{ id: "999", name: "", status: "ENABLED", channelType: "SEARCH", budgetMicros: null, impressions: 1, clicks: 1, costMicros: "10000", ctr: 1, averageCpcMicros: "10000", conversions: 1 }], "clicks");
  assert.equal(rows[0].label, "999");
});
