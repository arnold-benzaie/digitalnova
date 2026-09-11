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

test("the blind-path code catalogue is exactly the seven documented codes", () => {
  assert.deepEqual(
    [...RADAR_INTELLIGENCE_BLIND_PATH_CODES].sort(),
    [
      "DISPLAY_CONTEXT_NOT_FOUND",
      "INVALID_CLIENT_ID",
      "PRE_GATEWAY_LOADER_FAILURE",
      "REGISTRY_GATEWAY_THROW",
      "SERVER_ACTION_UNHANDLED_ERROR",
      "SYSTEM_ADMIN_CHECK_FAILED",
      "FALLBACK_SUCCEEDED",
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

// ---------------- httpStatus: allowlisted, but independently re-validated ----------------

test("allows a validated httpStatus (400–599) through unchanged", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({ source: "advisory_core", code: "PROVIDER_ERROR", failureClass: "PROVIDER_4XX", httpStatus: 400, status: "error" }),
  );
  assert.deepEqual(calls[0][1], { source: "advisory_core", code: "PROVIDER_ERROR", failureClass: "PROVIDER_4XX", httpStatus: 400, status: "error" });
});

test("drops an httpStatus that fails independent re-validation — the logger does not trust its caller", async () => {
  for (const bad of [200, 301, 600, 999, 400.5, "401", NaN]) {
    const calls = await withCapturedWarn(() =>
      logRadarIntelligenceEvent({ source: "advisory_core", code: "PROVIDER_ERROR", failureClass: "PROVIDER_UNKNOWN", httpStatus: bad, status: "error" }),
    );
    assert.equal("httpStatus" in calls[0][1], false, `should have dropped ${bad}`);
    assert.deepEqual(Object.keys(calls[0][1]).sort(), ["code", "failureClass", "source", "status"]);
  }
});

test("the allowlist after this patch is EXACTLY source / code / failureClass / httpStatus / status — nothing else", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({
      source: "advisory_core",
      code: "PROVIDER_ERROR",
      failureClass: "PROVIDER_5XX",
      httpStatus: 503,
      status: "unavailable",
      // poisoned extras — must all be dropped, same as before this patch
      clientId: "11111111-1111-4111-8111-111111111111",
      userId: "user-secret",
      body: "provider response text",
    }),
  );
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["code", "failureClass", "httpStatus", "source", "status"].sort());
  const s = JSON.stringify(calls[0][1]);
  assert.equal(s.includes("11111111"), false);
  assert.equal(s.includes("user-secret"), false);
  assert.equal(s.includes("provider response text"), false);
});

// ---------------- V2: safe OpenAI provider-error metadata ----------------

test("logs a valid providerErrorType/providerErrorCode/providerErrorParam verbatim (already validated members/shapes)", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({
      source: "advisory_core",
      code: "PROVIDER_ERROR",
      failureClass: "PROVIDER_4XX",
      httpStatus: 400,
      provider: "openai",
      providerErrorType: "invalid_request_error",
      providerErrorCode: "unsupported_parameter",
      providerErrorParam: "max_tokens",
      status: "error",
    }),
  );
  assert.deepEqual(calls[0][1], {
    source: "advisory_core",
    code: "PROVIDER_ERROR",
    failureClass: "PROVIDER_4XX",
    httpStatus: 400,
    provider: "openai",
    providerErrorType: "invalid_request_error",
    providerErrorCode: "unsupported_parameter",
    providerErrorParam: "max_tokens",
    status: "error",
  });
});

test("drops an unrecognized providerErrorType/Code (not a member of the closed set) — never logs it verbatim", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({
      source: "advisory_core",
      code: "PROVIDER_ERROR",
      status: "error",
      providerErrorType: "some_future_type_nobody_reviewed",
      providerErrorCode: "some_future_code_nobody_reviewed",
    }),
  );
  assert.equal("providerErrorType" in calls[0][1], false);
  assert.equal("providerErrorCode" in calls[0][1], false);
  const s = JSON.stringify(calls[0][1]);
  assert.equal(s.includes("some_future"), false);
});

test("drops a malformed/unsafe providerErrorParam — never logs it verbatim, even when it embeds a secret-shaped string", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({
      source: "advisory_core",
      code: "PROVIDER_ERROR",
      status: "error",
      providerErrorParam: "max_tokens; Authorization: Bearer sk-ant-LEAK",
    }),
  );
  assert.equal("providerErrorParam" in calls[0][1], false);
  const s = JSON.stringify(calls[0][1]);
  assert.equal(s.includes("sk-ant-"), false);
  assert.equal(s.includes("Bearer"), false);
});

test("providerError* fields never carry error.message-shaped free text — a poisoned event object with an errorMessage field is still fully allowlist-filtered", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({
      source: "advisory_core",
      code: "PROVIDER_ERROR",
      status: "error",
      providerErrorType: "invalid_request_error",
      providerErrorCode: "unsupported_parameter",
      providerErrorParam: "max_tokens",
      // poisoned extra — not one of the three named fields, must be dropped
      errorMessage: "DO NOT PROPAGATE THIS TEXT",
    }),
  );
  assert.deepEqual(Object.keys(calls[0][1]).sort(), ["code", "providerErrorCode", "providerErrorParam", "providerErrorType", "source", "status"].sort());
  assert.equal(JSON.stringify(calls[0][1]).includes("DO NOT PROPAGATE"), false);
});

test("the allowlist now includes providerErrorType/providerErrorCode/providerErrorParam alongside every existing field", async () => {
  const calls = await withCapturedWarn(() =>
    logRadarIntelligenceEvent({
      source: "advisory_core",
      code: "PROVIDER_ERROR",
      failureClass: "PROVIDER_4XX",
      httpStatus: 400,
      provider: "openai",
      fallbackUsed: true,
      attempt: 2,
      providerErrorType: "invalid_request_error",
      providerErrorCode: "unsupported_parameter",
      providerErrorParam: "max_tokens",
      status: "error",
    }),
  );
  assert.deepEqual(
    Object.keys(calls[0][1]).sort(),
    ["source", "code", "failureClass", "httpStatus", "provider", "fallbackUsed", "attempt", "providerErrorType", "providerErrorCode", "providerErrorParam", "status"].sort(),
  );
});
