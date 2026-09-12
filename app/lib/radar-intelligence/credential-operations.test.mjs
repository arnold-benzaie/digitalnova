// RADAR INTELLIGENCE V2.1 — Phase E — credential-operations.ts tests.
// Pure, no DB, no network.
//
// Run: npx tsx --test lib/radar-intelligence/credential-operations.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";

const { CREDENTIAL_OPERATIONS_CAPABILITY } = await import("./credential-operations.ts");

test("CREDENTIAL_OPERATIONS_CAPABILITY is fixed at external-only", () => {
  assert.equal(CREDENTIAL_OPERATIONS_CAPABILITY, "external-only");
});

test("CREDENTIAL_OPERATIONS_CAPABILITY has no other possible value in this codebase today (no secret-manager write path exists)", () => {
  assert.ok(["external-only", "managed-secret-store"].includes(CREDENTIAL_OPERATIONS_CAPABILITY));
  assert.notEqual(CREDENTIAL_OPERATIONS_CAPABILITY, "managed-secret-store");
});
