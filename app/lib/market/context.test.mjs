// Pure unit tests — no DB, no network. Run with:
// npx tsx --test lib/market/context.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { isMarket, resolveMarketContext } from "./context.ts";

test("isMarket: accepts exactly CANADA/EUROPE, rejects everything else", () => {
  assert.equal(isMarket("CANADA"), true);
  assert.equal(isMarket("EUROPE"), true);
  assert.equal(isMarket("canada"), false, "case-sensitive — never a loose match");
  assert.equal(isMarket("USA"), false);
  assert.equal(isMarket(""), false);
  assert.equal(isMarket(null), false);
  assert.equal(isMarket(undefined), false);
  assert.equal(isMarket(42), false);
});

test("resolveMarketContext(null): returns null — no invented default", () => {
  assert.equal(resolveMarketContext(null), null);
  assert.equal(resolveMarketContext(undefined), null);
});

test("resolveMarketContext(CANADA): currency CAD, region CA", () => {
  const ctx = resolveMarketContext("CANADA");
  assert.equal(ctx.currency, "CAD");
  assert.equal(ctx.region, "CA");
  assert.equal(ctx.market, "CANADA");
});

test("resolveMarketContext(EUROPE): currency EUR, region EU", () => {
  const ctx = resolveMarketContext("EUROPE");
  assert.equal(ctx.currency, "EUR");
  assert.equal(ctx.region, "EU");
  assert.equal(ctx.market, "EUROPE");
});

test("resolveMarketContext: CANADA and EUROPE never share a currency", () => {
  const cad = resolveMarketContext("CANADA");
  const eur = resolveMarketContext("EUROPE");
  assert.notEqual(cad.currency, eur.currency);
});
