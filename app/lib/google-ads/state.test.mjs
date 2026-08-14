// Pure unit tests for the Google Ads OAuth state encode/decode/validate
// logic — the most security-critical part of the connect/callback flow.
// No DB, no network. Run with: npx tsx --test lib/google-ads/state.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { encodeGoogleAdsState, decodeGoogleAdsState, validateGoogleAdsState } = await import("./state.ts");

const BASE_STATE = { nonce: "nonce-abc", organizationId: "org-A", userId: "user-A", returnTo: "/dashboard/google-ads" };
const SESSION_A = { organizationId: "org-A", userId: "user-A" };

test("encodeGoogleAdsState/decodeGoogleAdsState round-trip exactly", () => {
  const encoded = encodeGoogleAdsState(BASE_STATE);
  assert.deepEqual(decodeGoogleAdsState(encoded), BASE_STATE);
});

test("decodeGoogleAdsState rejects garbage input instead of throwing", () => {
  assert.equal(decodeGoogleAdsState("not-valid-base64url-json"), null);
  assert.equal(decodeGoogleAdsState(Buffer.from("{}").toString("base64url")), null);
  assert.equal(decodeGoogleAdsState(Buffer.from(JSON.stringify({ nonce: "x" })).toString("base64url")), null);
});

test("validateGoogleAdsState: correct nonce + matching session -> ok", () => {
  const result = validateGoogleAdsState(BASE_STATE, "nonce-abc", SESSION_A);
  assert.deepEqual(result, { ok: true });
});

test("validateGoogleAdsState: missing cookie nonce -> invalid_state, never proceeds", () => {
  const result = validateGoogleAdsState(BASE_STATE, undefined, SESSION_A);
  assert.deepEqual(result, { ok: false, reason: "invalid_state" });
});

test("validateGoogleAdsState: cookie nonce mismatch (CSRF) -> invalid_state", () => {
  const result = validateGoogleAdsState(BASE_STATE, "some-other-nonce", SESSION_A);
  assert.deepEqual(result, { ok: false, reason: "invalid_state" });
});

test("validateGoogleAdsState: correct nonce but DIFFERENT organization in live session -> session_mismatch (never attaches org A's grant to org B)", () => {
  const result = validateGoogleAdsState(BASE_STATE, "nonce-abc", { organizationId: "org-B", userId: "user-A" });
  assert.deepEqual(result, { ok: false, reason: "session_mismatch" });
});

test("validateGoogleAdsState: correct nonce, same org, but DIFFERENT user in live session -> session_mismatch (never attaches user A's grant to user B, even same org)", () => {
  const result = validateGoogleAdsState(BASE_STATE, "nonce-abc", { organizationId: "org-A", userId: "user-B" });
  assert.deepEqual(result, { ok: false, reason: "session_mismatch" });
});

test("validateGoogleAdsState: nonce mismatch is checked before session mismatch (fails closed on the first violation)", () => {
  // Both nonce AND session are wrong — must report invalid_state (checked first), not session_mismatch.
  const result = validateGoogleAdsState(BASE_STATE, "wrong-nonce", { organizationId: "org-B", userId: "user-B" });
  assert.deepEqual(result, { ok: false, reason: "invalid_state" });
});
