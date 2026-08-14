// Pure unit tests for isSelectableGoogleAdsAccount() — the rule deciding
// which discovered rows are real, selectable advertiser accounts. No DB,
// no network. Run with: npx tsx --test --experimental-test-module-mocks lib/google-ads/accounts.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
mock.module("@/db", { namedExports: { db: {} } });

const { isSelectableGoogleAdsAccount } = await import("./accounts.ts");

test("a real, enabled, non-manager account is selectable", () => {
  assert.equal(isSelectableGoogleAdsAccount({ manager: false, status: "ENABLED" }), true);
});

test("a manager/MCC account is never selectable — you can't run/report ads directly on it", () => {
  assert.equal(isSelectableGoogleAdsAccount({ manager: true, status: "ENABLED" }), false);
});

test("a canceled/closed/suspended account is never selectable — offering it would only ever fail on the next report call", () => {
  for (const status of ["CANCELED", "CLOSED", "SUSPENDED"]) {
    assert.equal(isSelectableGoogleAdsAccount({ manager: false, status }), false, `status ${status} must be excluded`);
  }
});

test("a row with no status field at all is treated as selectable (not every API response includes it)", () => {
  assert.equal(isSelectableGoogleAdsAccount({ manager: false }), true);
});

test("manager:true always wins over an otherwise-enabled status", () => {
  assert.equal(isSelectableGoogleAdsAccount({ manager: true, status: "ENABLED" }), false);
});
