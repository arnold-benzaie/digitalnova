// Unit tests for categorizeGenericError() — a pure function (no "server-only"
// or @/db import anywhere in its dependency chain, see lib/db-transient-error.ts
// and lib/errors/categorize-generic-error.ts), modeled on the same split as
// lib/chat/technical-alert.test.mjs: this file needs no DB/network and no
// server-only mock.
import { test } from "node:test";
import assert from "node:assert/strict";

const { categorizeGenericError, GENERIC_ERROR_CATEGORIES } = await import("@/lib/errors/categorize-generic-error");

test("categorizeGenericError: db connection errors", () => {
  assert.equal(categorizeGenericError(new Error("EMAXCONNSESSION: max clients reached")), "db_connection");
  const pgError = Object.assign(new Error("Failed query: select 1"), { code: "53300" });
  assert.equal(categorizeGenericError(pgError), "db_connection");
});

test("categorizeGenericError: timeout", () => {
  assert.equal(categorizeGenericError(new Error("Request timeout after 12000ms")), "timeout");
});

test("categorizeGenericError: validation", () => {
  assert.equal(categorizeGenericError(new Error("Validation failed: name is required")), "validation");
  assert.equal(categorizeGenericError(new Error("invalid input")), "validation");
});

test("categorizeGenericError: not found", () => {
  assert.equal(categorizeGenericError(new Error("Organisation not found")), "not_found");
  assert.equal(categorizeGenericError(new Error("resource not_found")), "not_found");
});

test("categorizeGenericError: a genuinely ordinary failure falls back to unknown, not a guess", () => {
  assert.equal(categorizeGenericError(new Error("normal failure")), "unknown");
});

test("categorizeGenericError: never echoes a secret-looking message back — password", () => {
  const category = categorizeGenericError(new Error("password=SECRET123"));
  assert.doesNotMatch(category, /SECRET123|password/i);
  assert.ok(GENERIC_ERROR_CATEGORIES.includes(category));
});

test("categorizeGenericError: never echoes a secret-looking message back — token", () => {
  const category = categorizeGenericError(new Error("token=abc123"));
  assert.doesNotMatch(category, /abc123|token/i);
  assert.ok(GENERIC_ERROR_CATEGORIES.includes(category));
});

test("categorizeGenericError: never echoes a secret-looking message back — email", () => {
  const category = categorizeGenericError(new Error("email=user@example.com"));
  assert.doesNotMatch(category, /user@example\.com|email/i);
  assert.ok(GENERIC_ERROR_CATEGORIES.includes(category));
});

test("categorizeGenericError: an arbitrary non-Error payload never leaks into the category", () => {
  const payload = { token: "sk-live-abc123", password: "SECRET123", nested: { email: "user@example.com" } };
  const category = categorizeGenericError(payload);
  assert.ok(GENERIC_ERROR_CATEGORIES.includes(category));
  assert.doesNotMatch(JSON.stringify(category), /sk-live|SECRET123|user@example\.com/);
});

test("categorizeGenericError: non-Error, non-object inputs never throw and stay in the closed set", () => {
  assert.ok(GENERIC_ERROR_CATEGORIES.includes(categorizeGenericError("not even an Error instance")));
  assert.ok(GENERIC_ERROR_CATEGORIES.includes(categorizeGenericError(undefined)));
  assert.ok(GENERIC_ERROR_CATEGORIES.includes(categorizeGenericError(null)));
});
