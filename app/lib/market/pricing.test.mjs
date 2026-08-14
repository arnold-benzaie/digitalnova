// Pure unit tests — no DB, no network. Run with:
// npx tsx --test lib/market/pricing.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { resolvePlanPrice } from "./pricing.ts";

const PLAN_WITH_CAD = { id: "pro", name: "Pro", priceEuros: 149, priceCad: 199, billingInterval: "monthly", description: "" };
const PLAN_WITHOUT_CAD = { id: "starter", name: "Starter", priceEuros: 49, priceCad: null, billingInterval: "monthly", description: "" };

test("resolvePlanPrice: EUROPE market always resolves to the plan's EUR price, regardless of priceCad", () => {
  const resolved = resolvePlanPrice(PLAN_WITH_CAD, "EUROPE");
  assert.deepEqual(resolved, { amount: 149, currency: "EUR", pending: false });
});

test("resolvePlanPrice: CANADA market resolves to the plan's own CAD price when one is set — never the EUR figure, never a converted guess", () => {
  const resolved = resolvePlanPrice(PLAN_WITH_CAD, "CANADA");
  assert.deepEqual(resolved, { amount: 199, currency: "CAD", pending: false });
});

test("resolvePlanPrice: CANADA market with no confirmed CAD price for this plan -> pending, never falls back to EUR", () => {
  const resolved = resolvePlanPrice(PLAN_WITHOUT_CAD, "CANADA");
  assert.equal(resolved.pending, true);
  assert.equal(resolved.amount, null);
  assert.notEqual(resolved.currency, "EUR", "must never silently show the EUR price for a Canadian organization");
});

test("resolvePlanPrice: no organization market set -> pending, never defaults to EUR or CAD", () => {
  const resolved = resolvePlanPrice(PLAN_WITH_CAD, null);
  assert.equal(resolved.pending, true);
  assert.equal(resolved.currency, null);
});
