// Pure-function tests for the client dashboard's rule-based signal engine —
// run with: npx tsx --test lib/dashboard-signals.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { computeDashboardSignals, pickTopPriorities, pickNextBestAction, buildContinueItems, buildMorningBrief } from "./dashboard-signals.ts";

const CONNECTED_ALL_OK = {
  connected: true,
  gbp: { scopeGranted: true, state: "synced" },
  analytics: { scopeGranted: true, state: "synced" },
  searchConsole: { scopeGranted: true, state: "synced" },
};

const BASE_INPUT = {
  isGbpConnected: true,
  onboardingCompleted: true,
  hasAudit: true,
  pendingReviewsCount: 0,
  viewsDeltaPct: null,
  google: CONNECTED_ALL_OK,
};

test("computeDashboardSignals: fully healthy org produces zero signals", () => {
  assert.deepEqual(computeDashboardSignals(BASE_INPUT), []);
});

test("computeDashboardSignals: never invents a signal without its backing condition", () => {
  const signals = computeDashboardSignals(BASE_INPUT);
  for (const s of signals) assert.ok(s.href, `signal ${s.kind} must always have a real destination`);
});

test("computeDashboardSignals: sync error is critical", () => {
  const input = { ...BASE_INPUT, google: { ...CONNECTED_ALL_OK, analytics: { scopeGranted: true, state: "error", lastError: "token expired" } } };
  const signals = computeDashboardSignals(input);
  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, "sync_error_analytics");
  assert.equal(signals[0].criticality, "critical");
});

test("computeDashboardSignals: ready_to_sync (granted, never synced) is high, not critical", () => {
  const input = { ...BASE_INPUT, google: { ...CONNECTED_ALL_OK, gbp: { scopeGranted: true, state: "ready_to_sync" } } };
  const signals = computeDashboardSignals(input);
  assert.equal(signals[0].kind, "never_synced_gbp");
  assert.equal(signals[0].criticality, "high");
});

test("computeDashboardSignals: scope not granted produces no signal (nothing to act on yet)", () => {
  const input = { ...BASE_INPUT, google: { ...CONNECTED_ALL_OK, analytics: { scopeGranted: false, state: "ready_to_sync" } } };
  assert.deepEqual(computeDashboardSignals(input), []);
});

test("computeDashboardSignals: views_up only fires at/above the real threshold", () => {
  assert.equal(computeDashboardSignals({ ...BASE_INPUT, viewsDeltaPct: 14 }).length, 0);
  const signals = computeDashboardSignals({ ...BASE_INPUT, viewsDeltaPct: 15 });
  assert.equal(signals.length, 1);
  assert.equal(signals[0].kind, "views_up");
});

test("computeDashboardSignals: pending reviews only counted when GBP connected", () => {
  const disconnected = computeDashboardSignals({ ...BASE_INPUT, isGbpConnected: false, pendingReviewsCount: 3 });
  assert.ok(!disconnected.some((s) => s.kind === "pending_reviews"));
});

test("pickTopPriorities: caps at max and sorts critical first", () => {
  const input = {
    ...BASE_INPUT,
    onboardingCompleted: false,
    hasAudit: false,
    isGbpConnected: false,
    viewsDeltaPct: 20,
    google: { ...CONNECTED_ALL_OK, analytics: { scopeGranted: true, state: "error", lastError: "x" } },
  };
  const signals = computeDashboardSignals(input);
  const top = pickTopPriorities(signals, 2);
  assert.equal(top.length, 2);
  assert.equal(top[0].criticality, "critical");
});

test("pickNextBestAction: the strongest criticality always wins, regardless of array order", () => {
  const signals = [
    { kind: "views_up", criticality: "opportunity", href: "/a", pct: 20 },
    { kind: "onboarding_incomplete", criticality: "high", href: "/b" },
    { kind: "sync_error_gbp", criticality: "critical", href: "/c" },
    { kind: "no_audit_yet", criticality: "medium", href: "/d" },
  ];
  assert.equal(pickNextBestAction(signals).kind, "sync_error_gbp");
});

test("pickNextBestAction: reversed input order still picks the same winner", () => {
  const signals = [
    { kind: "sync_error_gbp", criticality: "critical", href: "/c" },
    { kind: "onboarding_incomplete", criticality: "high", href: "/b" },
  ];
  assert.equal(pickNextBestAction([...signals].reverse()).kind, "sync_error_gbp");
});

test("pickNextBestAction: null when no signals", () => {
  assert.equal(pickNextBestAction([]), null);
});

test("buildContinueItems: never fabricates an item beyond real state", () => {
  assert.deepEqual(buildContinueItems(BASE_INPUT), [
    { key: "last_audit", href: "/dashboard/audits" },
    { key: "gbp", href: "/dashboard/gbp" },
  ]);
});

test("buildContinueItems: onboarding incomplete takes priority position", () => {
  const items = buildContinueItems({ ...BASE_INPUT, onboardingCompleted: false });
  assert.equal(items[0].key, "onboarding");
});

test("buildMorningBrief: empty when nothing is real", () => {
  assert.deepEqual(buildMorningBrief({ prioritiesCount: 0, mostRecentSync: null, viewsDeltaPct: null, actionsSinceLastVisit: null }), []);
});

test("buildMorningBrief: only includes lines with real backing data, capped at 4", () => {
  const lines = buildMorningBrief({
    prioritiesCount: 2,
    mostRecentSync: { product: "analytics", syncedAt: new Date() },
    viewsDeltaPct: 18,
    actionsSinceLastVisit: 3,
  });
  assert.equal(lines.length, 4);
  assert.equal(lines[0].kind, "priorities_count");
});

test("buildMorningBrief: actionsSinceLastVisit of 0 is omitted, not shown as '0 actions'", () => {
  const lines = buildMorningBrief({ prioritiesCount: 0, mostRecentSync: null, viewsDeltaPct: null, actionsSinceLastVisit: 0 });
  assert.deepEqual(lines, []);
});
