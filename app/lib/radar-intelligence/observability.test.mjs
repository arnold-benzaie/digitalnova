// RADAR INTELLIGENCE — safe server observability tests.
//
// logRadarIntelligenceEvent is the ONE choke point every diagnostic log
// line goes through. Proves:
//   - the fixed "[RADAR_INTELLIGENCE]" prefix + only the four allowlisted
//     keys ever reach console.warn
//   - undefined optional fields are omitted, never logged as `undefined`
//   - DEFENSE IN DEPTH: any extra/forbidden field smuggled onto the event
//     object (clientId, userId, apiKey, prompt, a raw error) is silently
//     dropped — never reaches the log line
//   - no UUID shape, auth header name/value, or "sk-ant-" ever appears
//   - the blind-path code catalogue is exactly the documented six
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/observability.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { logRadarIntelligenceEvent, RADAR_INTELLIGENCE_BLIND_PATH_CODES } = await import("./observability.ts");

async function withCapturedWarn(fn) {
  const calls = [];
  const original = console.warn;
  console.warn = (...args) => {
    calls.push(args);
  };
  try {
    await fn();
  } finally {
    console.warn = original;
  }
  return calls;
}

test("logs with the fixed prefix and exactly the four allowlisted keys when all are supplied", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({ source: "advisory_core", code: "PROVIDER_ERROR", failureClass: "PROVIDER_4XX", status: "error" }),
  );
  assert.equal(calls.length, 1);
  assert.equal(calls[0][0], "[RADAR_INTELLIGENCE]");
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "PROVIDER_ERROR", failureClass: "PROVIDER_4XX", status: "error" });
});

test("omits failureClass/status when not supplied — never logs an explicit undefined", async () => {
  const calls = await withCapturedWarn(() => logRadarIntelligenceEvent({ source: "advisory_core", code: "PRE_GATEWAY_LOADER_FAILURE" }));
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "PRE_GATEWAY_LOADER_FAILURE" });
  assert.equal("failureClass" in calls[0][1], false);
  assert.equal("status" in calls[0][1], false);
});

test("defense in depth: any extra field on the event object never reaches the log line", async () => {
  const poisoned = {
    source: "advisory_core",
    code: "PROVIDER_ERROR",
    status: "error",
    clientId: "11111111-1111-4111-8111-111111111111",
    userId: "user-secret-id",
    apiKey: "sk-ant-LEAK",
    "x-api-key": "sk-ant-LEAK",
    Authorization: "Bearer sk-ant-LEAK",
    prompt: "do X for me",
    systemInstruction: "you are an assistant",
    rawBody: { content: [{ text: "provider output" }] },
    errorMessage: "DATABASE_URL=postgres://u:p@h/db",
    stack: "at secretThing()",
  };
  const calls = await withCapturedWarn(() => logRadarIntelligenceEvent(poisoned));
  assert.equal(calls.length, 1);
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["code", "source", "status"]);
  const s = JSON.stringify(calls[0][1]);
  for (const forbidden of [
    "11111111",
    "user-secret-id",
    "sk-ant-LEAK",
    "x-api-key",
    "Authorization",
    "Bearer",
    "do X for me",
    "you are an assistant",
    "provider output",
    "DATABASE_URL",
    "postgres://",
    "secretThing",
  ]) {
    assert.equal(s.includes(forbidden), false, `"${forbidden}" leaked into the log line`);
  }
});

test("no log line, however constructed, ever contains a UUID shape or an auth header name/value", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({ source: "server_action_boundary", code: "SERVER_ACTION_UNHANDLED_ERROR", status: "error" }),
  );
  const s = JSON.stringify(calls[0][1]);
  assert.equal(/[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}/i.test(s), false);
  assert.equal(/x-api-key|authorization|bearer|sk-ant-/i.test(s), false);
});

test("the blind-path code catalogue is exactly the six documented codes", () => {
  assert.deepEqual(
    [...RADAR_INTELLIGENCE_BLIND_PATH_CODES].sort(),
    [
      "DISPLAY_CONTEXT_NOT_FOUND",
      "INVALID_CLIENT_ID",
      "PRE_GATEWAY_LOADER_FAILURE",
      "REGISTRY_GATEWAY_THROW",
      "SERVER_ACTION_UNHANDLED_ERROR",
      "SYSTEM_ADMIN_CHECK_FAILED",
    ].sort(),
  );
});

test("logRadarIntelligenceEvent is a pure side-effecting function — no return value, never throws on a well-formed event", async () => {
  let returned;
  await withCapturedWarn(() => {
    returned = logRadarIntelligenceEvent({ source: "advisory_core", code: "NO_CAPABLE_PROVIDER" });
  });
  assert.equal(returned, undefined);
});
