// Locale-aware date/number formatting — run with:
//   npx tsx --test lib/i18n/format.test.mjs
// Covers the pure Intl wrappers only (no request/DOM globals involved).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatDate, formatDateTime, formatNumber, formatRelativeTime } from "./format.ts";

const SAMPLE_DATE = new Date("2026-03-05T14:30:00Z");

test("formatDate: renders fr-FR and en-US conventions differently for the same date", () => {
  const fr = formatDate(SAMPLE_DATE, "fr", { day: "numeric", month: "long", year: "numeric" });
  const en = formatDate(SAMPLE_DATE, "en", { day: "numeric", month: "long", year: "numeric" });
  assert.match(fr, /mars/i);
  assert.match(en, /march/i);
  assert.notEqual(fr, en);
});

test("formatDate: accepts an ISO string identically to a Date instance", () => {
  const fromString = formatDate(SAMPLE_DATE.toISOString(), "fr", { day: "numeric", month: "short" });
  const fromDate = formatDate(SAMPLE_DATE, "fr", { day: "numeric", month: "short" });
  assert.equal(fromString, fromDate);
});

test("formatDateTime: default dateStyle/timeStyle never collides with itself across locales", () => {
  const fr = formatDateTime(SAMPLE_DATE, "fr");
  const en = formatDateTime(SAMPLE_DATE, "en");
  assert.equal(typeof fr, "string");
  assert.equal(typeof en, "string");
  assert.notEqual(fr, en);
});

test("formatNumber: uses a comma decimal/space grouping in fr-FR vs. comma grouping in en-US", () => {
  const fr = formatNumber(1234.5, "fr");
  const en = formatNumber(1234.5, "en");
  assert.match(en, /1,234\.5/);
  assert.notEqual(fr, en);
});

test("formatCurrency: same amount+currency renders with locale-appropriate punctuation, never converts currency", () => {
  const fr = formatCurrency(42, "EUR", "fr");
  const en = formatCurrency(42, "EUR", "en");
  assert.match(fr, /€/);
  assert.match(en, /€/);
  assert.notEqual(fr, en);
});

test("formatRelativeTime: past dates render as past-tense phrasing in both locales", () => {
  const now = new Date("2026-03-05T12:00:00Z");
  const threeDaysAgo = new Date("2026-03-02T12:00:00Z");
  const fr = formatRelativeTime(threeDaysAgo, "fr", now);
  const en = formatRelativeTime(threeDaysAgo, "en", now);
  assert.match(fr, /il y a/i);
  assert.match(en, /ago/i);
});
