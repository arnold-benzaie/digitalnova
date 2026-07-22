// Pure-function tests for competitor comparison scoring — run with:
//   npx tsx --test lib/gbp-audit/competitor-scoring.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { compareToCompetitor } from "./competitor-scoring.ts";

const NO_DATA = { rating: null, reviewCount: null, photoCount: null, postsRecent: null };

test("compareToCompetitor: we lead on every metric -> overall ahead", () => {
  const ours = { rating: 480, reviewCount: 120, photoCount: 40, postsRecent: true };
  const theirs = { rating: 410, reviewCount: 60, photoCount: 10, postsRecent: false };
  const result = compareToCompetitor(ours, theirs);
  assert.equal(result.overallVerdict, "ahead");
  assert.equal(result.aheadCount, 4);
  assert.equal(result.behindCount, 0);
});

test("compareToCompetitor: we trail on every metric -> overall behind", () => {
  const ours = { rating: 410, reviewCount: 60, photoCount: 10, postsRecent: false };
  const theirs = { rating: 480, reviewCount: 120, photoCount: 40, postsRecent: true };
  const result = compareToCompetitor(ours, theirs);
  assert.equal(result.overallVerdict, "behind");
  assert.equal(result.behindCount, 4);
});

test("compareToCompetitor: equal on every known metric -> tied", () => {
  const ours = { rating: 450, reviewCount: 100, photoCount: 20, postsRecent: true };
  const theirs = { rating: 450, reviewCount: 100, photoCount: 20, postsRecent: true };
  const result = compareToCompetitor(ours, theirs);
  assert.equal(result.overallVerdict, "tied");
});

test("compareToCompetitor: missing data on both sides -> unknown, not a false 'tied'", () => {
  const result = compareToCompetitor(NO_DATA, NO_DATA);
  assert.equal(result.overallVerdict, "unknown");
  assert.ok(result.metrics.every((m) => m.verdict === "unknown"));
});

test("compareToCompetitor: mixed — 2 ahead, 1 behind, 1 unknown -> overall ahead", () => {
  const ours = { rating: 480, reviewCount: 50, photoCount: null, postsRecent: true };
  const theirs = { rating: 410, reviewCount: 90, photoCount: 30, postsRecent: false };
  const result = compareToCompetitor(ours, theirs);
  // rating: ahead, reviewCount: behind, photoCount: unknown, postsRecent: ahead
  assert.equal(result.aheadCount, 2);
  assert.equal(result.behindCount, 1);
  assert.equal(result.overallVerdict, "ahead");
});

test("compareToCompetitor: postsRecent compares as boolean, not numeric", () => {
  const result = compareToCompetitor(
    { rating: null, reviewCount: null, photoCount: null, postsRecent: true },
    { rating: null, reviewCount: null, photoCount: null, postsRecent: false },
  );
  const postsMetric = result.metrics.find((m) => m.metric === "postsRecent");
  assert.equal(postsMetric.verdict, "ahead");
});
