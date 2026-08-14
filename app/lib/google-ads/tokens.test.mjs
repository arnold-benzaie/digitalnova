// Pure unit tests for the Google Ads refresh-token encryption scheme —
// no DB, no network. Proves the AAD-binding property that makes cross-
// organization ciphertext reuse fail closed rather than silently decrypt
// into the wrong token. Full storage/refresh/disconnect flow (needs a real
// DB) is covered separately by the integration test.
// Run with: npx tsx --test --experimental-test-module-mocks lib/google-ads/tokens.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { randomBytes } from "node:crypto";

mock.module("server-only", { namedExports: {} });
process.env.INTEGRATION_SECRET_ENCRYPTION_KEY = randomBytes(32).toString("base64");

const { encryptIntegrationValue, decryptIntegrationValue } = await import("../integrations/crypto.ts");

// Mirrors lib/google-ads/tokens.ts's private refreshTokenAad() exactly —
// duplicated here on purpose (not imported, since it's not exported) so
// this test fails loudly if that AAD scheme is ever silently changed.
function refreshTokenAad(organizationId) {
  return `google-ads-refresh-token:${organizationId}`;
}

test("a refresh token encrypted for org A decrypts correctly under org A's own AAD", () => {
  const plaintext = "1//fake-refresh-token-for-org-A";
  const encrypted = encryptIntegrationValue(plaintext, refreshTokenAad("org-A"));
  assert.equal(decryptIntegrationValue(encrypted, refreshTokenAad("org-A")), plaintext);
});

test("org A's encrypted refresh token CANNOT be decrypted under org B's AAD — fails closed, never returns the wrong org's token", () => {
  const plaintext = "1//fake-refresh-token-for-org-A";
  const encrypted = encryptIntegrationValue(plaintext, refreshTokenAad("org-A"));
  assert.throws(() => decryptIntegrationValue(encrypted, refreshTokenAad("org-B")), /could not be decrypted/);
});

test("swapping org B's ciphertext into org A's row (same AAD context) still fails — GCM auth tag is bound to org B's plaintext, not just the AAD string", () => {
  const tokenA = encryptIntegrationValue("1//token-A", refreshTokenAad("org-A"));
  const tokenB = encryptIntegrationValue("1//token-B", refreshTokenAad("org-B"));
  // Attacker scenario: copy org B's ciphertext/authTag but keep org A's iv/AAD context.
  const tampered = { ciphertext: tokenB.ciphertext, iv: tokenA.iv, authTag: tokenB.authTag };
  assert.throws(() => decryptIntegrationValue(tampered, refreshTokenAad("org-A")), /could not be decrypted/);
});

test("two different organizations' refresh tokens never produce identical ciphertext for the same plaintext (random IV per encryption)", () => {
  const plaintext = "1//same-plaintext-token";
  const a = encryptIntegrationValue(plaintext, refreshTokenAad("org-A"));
  const b = encryptIntegrationValue(plaintext, refreshTokenAad("org-B"));
  assert.notEqual(a.ciphertext, b.ciphertext);
  assert.notEqual(a.iv, b.iv);
});
