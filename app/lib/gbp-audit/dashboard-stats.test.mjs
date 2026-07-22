// Pure-function tests for the dashboard's period series builder — run with:
//   npx tsx --test lib/gbp-audit/dashboard-stats.test.mjs
// Uses relative "today - N days" math rather than hardcoded date strings,
// since the underlying functions call Date.now() internally (deliberately —
// see the file's own comment on why that's not inside a component body).
import { test } from "node:test";
import assert from "node:assert/strict";
import { buildAuditsOverTimeSeries, daysAgo as daysAgoFn, isDashboardPeriodDays, DASHBOARD_PERIOD_OPTIONS } from "./dashboard-stats.ts";

const DAY_MS = 24 * 60 * 60 * 1000;
function daysAgo(n) {
  return new Date(Date.now() - n * DAY_MS);
}
function frDate(d) {
  return d.toLocaleDateString("fr-FR", { day: "2-digit", month: "2-digit" });
}

test("buildAuditsOverTimeSeries: returns exactly `days` buckets", () => {
  assert.equal(buildAuditsOverTimeSeries([], 14).length, 14);
  assert.equal(buildAuditsOverTimeSeries([], 7).length, 7);
  assert.equal(buildAuditsOverTimeSeries([], 90).length, 90);
});

test("buildAuditsOverTimeSeries: empty input -> every bucket is 0", () => {
  const series = buildAuditsOverTimeSeries([], 14);
  assert.ok(series.every((s) => s.count === 0));
});

test("buildAuditsOverTimeSeries: last bucket is today, first is (days-1) days ago", () => {
  const series = buildAuditsOverTimeSeries([], 14);
  assert.equal(series[0].date, frDate(daysAgo(13)));
  assert.equal(series[13].date, frDate(daysAgo(0)));
});

test("buildAuditsOverTimeSeries: rows within the window are counted on their own day", () => {
  const rows = [{ createdAt: daysAgo(0) }, { createdAt: daysAgo(0) }, { createdAt: daysAgo(5) }];
  const series = buildAuditsOverTimeSeries(rows, 14);
  const today = series.find((s) => s.date === frDate(daysAgo(0)));
  const fiveDaysAgo = series.find((s) => s.date === frDate(daysAgo(5)));
  assert.equal(today.count, 2);
  assert.equal(fiveDaysAgo.count, 1);
  assert.equal(series.reduce((sum, s) => sum + s.count, 0), 3);
});

test("buildAuditsOverTimeSeries: rows outside the window are silently dropped, not errored", () => {
  const rows = [{ createdAt: daysAgo(30) }];
  const series = buildAuditsOverTimeSeries(rows, 14);
  assert.equal(series.reduce((sum, s) => sum + s.count, 0), 0);
});

test("daysAgo: returns a Date roughly N*24h in the past", () => {
  const result = daysAgoFn(14);
  const expectedMs = 14 * DAY_MS;
  const actualMs = Date.now() - result.getTime();
  assert.ok(Math.abs(actualMs - expectedMs) < 5000, `expected ~${expectedMs}ms ago, got ${actualMs}ms ago`);
});

test("isDashboardPeriodDays: accepts only the 4 supported period lengths", () => {
  for (const option of DASHBOARD_PERIOD_OPTIONS) assert.ok(isDashboardPeriodDays(option));
  assert.equal(isDashboardPeriodDays(14), true);
  assert.equal(isDashboardPeriodDays(21), false);
  assert.equal(isDashboardPeriodDays(NaN), false);
  assert.equal(isDashboardPeriodDays(undefined), false);
});
