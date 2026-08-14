// Pure unit tests for date-range validation and GAQL result parsing — no
// DB, no network. Run with: npx tsx --test --experimental-test-module-mocks lib/google-ads/reports.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
// reports.ts imports lib/google-ads/tokens.ts, which imports @/db — stub it
// out so this file can load without a real DATABASE_URL. None of the pure
// functions tested here (date-range validation, GAQL row parsing) touch it.
mock.module("@/db", { namedExports: { db: {} } });

const { GOOGLE_ADS_DATE_RANGES, isGoogleAdsDateRange, parseAccountSummaryRow, parseCampaignRow } = await import("./reports.ts");

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
