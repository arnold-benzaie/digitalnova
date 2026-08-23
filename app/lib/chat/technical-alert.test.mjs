// Unit tests for categorizeChatError() — a pure function, no DB/network
// needed. The DB-dependent orchestration (recordChatFailureAndMaybeAlert:
// insert, threshold, cooldown) is covered by a real-Postgres integration
// test instead (drizzle's query builder isn't meaningfully mockable),
// exactly the same split already used elsewhere in this codebase between
// unit tests and lib/chat/chat.integration.test.mjs.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

// technical-alert.ts imports "server-only" AND @/db at module scope
// (even though categorizeChatError itself is pure) — @/db's own index.ts
// throws synchronously at import time if DATABASE_URL is unset. A
// syntactically valid but never-connected-to placeholder is enough:
// this file never runs a query, only imports the pure function below.
mock.module("server-only", { namedExports: {} });
if (!process.env.DATABASE_URL) process.env.DATABASE_URL = "postgresql://user:pass@localhost:1/never_queried_in_this_test";

const { categorizeChatError } = await import("@/lib/chat/technical-alert");

test("categorizeChatError: JSON/schema failures", () => {
  assert.equal(categorizeChatError(new Error("ai-deepseek-provider: invalid_json")), "invalid_json");
  assert.equal(categorizeChatError(new Error("ai-deepseek-provider: schema_validation_failed")), "invalid_json");
});

test("categorizeChatError: empty response", () => {
  assert.equal(categorizeChatError(new Error("ai-deepseek-provider: empty content from the Chat Completions API")), "empty_response");
  assert.equal(categorizeChatError(new Error("ai-openai-provider: empty output_text from the Responses API")), "empty_response");
});

test("categorizeChatError: misconfiguration", () => {
  assert.equal(categorizeChatError(new Error("ai-deepseek-provider: DEEPSEEK_API_KEY is not configured")), "misconfigured");
});

test("categorizeChatError: timeout", () => {
  assert.equal(categorizeChatError(new Error("Request timeout after 12000ms")), "timeout");
});

test("categorizeChatError: unknown/other errors fall back to a generic, safe category", () => {
  assert.equal(categorizeChatError(new Error("ECONNRESET")), "provider_unavailable");
  assert.equal(categorizeChatError("not even an Error instance"), "provider_unavailable");
  assert.equal(categorizeChatError(undefined), "provider_unavailable");
});

test("categorizeChatError never echoes the raw error message back — the category is always one of the fixed, safe labels", () => {
  const secretLookingMessage = "DEEPSEEK_API_KEY=sk-should-never-leak, connection to postgres://user:pass@host failed";
  const category = categorizeChatError(new Error(secretLookingMessage));
  assert.doesNotMatch(category, /sk-|postgres:\/\/|DEEPSEEK_API_KEY/);
  assert.ok(["invalid_json", "empty_response", "misconfigured", "timeout", "provider_unavailable"].includes(category));
});
