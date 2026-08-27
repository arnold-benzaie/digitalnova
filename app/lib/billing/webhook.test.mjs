// Unit tests for the existing verifyFastspringSignature helper
// (lib/billing/webhook.ts) — the Chantier 2 Phase 5 audit found zero
// existing tests for it. No modification to the helper itself was made;
// these tests exercise its already-existing behavior against a fixture
// (fake) secret only. No real FastSpring secret, no network.
// Run with: npx tsx --test lib/billing/webhook.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import crypto from "node:crypto";
import { verifyFastspringSignature } from "./webhook.ts";

const FIXTURE_SECRET = "fixture-only-not-a-real-fastspring-secret";
const RAW_BODY = JSON.stringify({ events: [{ type: "order.completed", data: { order: "fs-order-1" } }] });

function sign(body, secret) {
  return crypto.createHmac("sha256", secret).update(body, "utf8").digest("base64");
}

test("a correctly computed HMAC-SHA256/Base64 signature verifies as true", () => {
  const signature = sign(RAW_BODY, FIXTURE_SECRET);
  assert.equal(verifyFastspringSignature(RAW_BODY, signature, FIXTURE_SECRET), true);
});

test("a missing signature header is rejected", () => {
  assert.equal(verifyFastspringSignature(RAW_BODY, null, FIXTURE_SECRET), false);
});

test("an incorrect signature is rejected", () => {
  const wrongSignature = sign(RAW_BODY, "a-completely-different-secret");
  assert.equal(verifyFastspringSignature(RAW_BODY, wrongSignature, FIXTURE_SECRET), false);
});

test("a body tampered with after signing is rejected", () => {
  const signature = sign(RAW_BODY, FIXTURE_SECRET);
  const tamperedBody = RAW_BODY.replace("order.completed", "order.refunded");
  assert.equal(verifyFastspringSignature(tamperedBody, signature, FIXTURE_SECRET), false);
});

test("a signature of a different length than expected is rejected", () => {
  assert.equal(verifyFastspringSignature(RAW_BODY, "too-short", FIXTURE_SECRET), false);
});

test("an empty secret is rejected", () => {
  const signature = sign(RAW_BODY, FIXTURE_SECRET);
  assert.equal(verifyFastspringSignature(RAW_BODY, signature, ""), false);
});
