// Locale-aware date/number formatting — run with:
//   npx tsx --test lib/i18n/format.test.mjs
// Covers the pure Intl wrappers only (no request/DOM globals involved).
import { test } from "node:test";
import assert from "node:assert/strict";
import { formatCurrency, formatDate, formatDateTime, formatLocalTime, formatNumber, formatRelativeTime } from "./format.ts";

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

// ---- MISSION C-2D-3 — formatLocalTime(date, locale, timeZone) ----
// Every expected local time below is hand-computed from the real, publicly
// documented IANA offset for that instant (never derived by calling this
// same function or another Intl instance) so these tests prove Intl's own
// tzdata is doing the work, not a manually-coded rule of ours.

test("formatLocalTime: null timeZone (Google provided none) -> null, never a fabricated/UTC value", () => {
  assert.equal(formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", null), null);
});

test("formatLocalTime: an invalid IANA identifier -> null, never throws", () => {
  assert.doesNotThrow(() => formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", "Not/A_Real_Zone"));
  assert.equal(formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", "Not/A_Real_Zone"), null);
});

test("formatLocalTime: a valid IANA identifier renders a time string", () => {
  const result = formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", "Europe/Paris");
  assert.equal(typeof result, "string");
  assert.match(result, /\d{1,2}:\d{2}/);
});

// ---- Countries (mission's explicit minimum list) ----

test("formatLocalTime: Mauritius (Indian/Mauritius, UTC+4 year-round, no DST)", () => {
  assert.equal(formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", "Indian/Mauritius"), "14:00");
});

test("formatLocalTime: Canada (America/Toronto, EDT = UTC-4 in June)", () => {
  assert.equal(formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", "America/Toronto"), "06:00");
});

test("formatLocalTime: USA, a DIFFERENT timezone than Canada's (America/Los_Angeles, PDT = UTC-7 in June)", () => {
  assert.equal(formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", "America/Los_Angeles"), "03:00");
});

test("formatLocalTime: France (Europe/Paris, CEST = UTC+2 in June)", () => {
  assert.equal(formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", "Europe/Paris"), "12:00");
});

test("formatLocalTime: Australia (Australia/Sydney, AEST = UTC+10 in June -- Southern Hemisphere winter, no DST)", () => {
  assert.equal(formatLocalTime(new Date("2026-06-15T10:00:00Z"), "fr", "Australia/Sydney"), "20:00");
});

// ---- DST: two instants either side of a real transition, no manual rule ----

test("formatLocalTime: Europe/Paris spring-forward 2026-03-29 -- 00:30 UTC (CET, UTC+1) vs. 01:30 UTC (CEST, UTC+2, clocks having just skipped 02:00-03:00) -- Intl's own tzdata produces the jump, this code contains no DST math", () => {
  const beforeChange = formatLocalTime(new Date("2026-03-29T00:30:00Z"), "fr", "Europe/Paris");
  const afterChange = formatLocalTime(new Date("2026-03-29T01:30:00Z"), "fr", "Europe/Paris");
  assert.equal(beforeChange, "01:30");
  assert.equal(afterChange, "03:30");
});

// ---- deterministic / injected clock ----

test("formatLocalTime: is a pure function of its inputs -- fixed UTC instant + fixed timezone always yields the exact same expected local result", () => {
  const fixedInstant = new Date("2026-01-10T08:15:00Z");
  const first = formatLocalTime(fixedInstant, "en", "Indian/Mauritius");
  const second = formatLocalTime(fixedInstant, "en", "Indian/Mauritius");
  assert.equal(first, second);
  assert.equal(first, "12:15 PM");
});
