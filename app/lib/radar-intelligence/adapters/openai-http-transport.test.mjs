// RADAR INTELLIGENCE V2 — real OpenAI HTTP transport unit tests.
//
// This file did NOT exist before this mission — the prior diagnostic
// identified its absence as a concrete test blind spot (the file that
// actually constructs the real OpenAI wire request had zero dedicated
// tests, unlike anthropic-http-transport.test.mjs). It mirrors that
// file's structure and every one of its guarantees, adapted to OpenAI's
// request/auth shape and to the NEW safe provider-error metadata
// extraction added in this mission.
//
// ZERO network: an injected fake `fetch` simulates 200 / 400 / 401 / 429 /
// 500 / invalid-JSON / AbortError / network-throw. Proves:
//   - exact outbound request: URL, POST, content-type, Authorization
//     Bearer = the fake key IN THE FAKE REQUEST, Chat Completions body
//     shape (model / messages / response_format), and the token-limit
//     FIELD NAME: `max_completion_tokens` for a GPT-5-family model
//     (isGpt5FamilyModel) — the proven fix for Production's 400
//     unsupported_parameter on `max_tokens` — and the pre-existing
//     `max_tokens` unchanged for every other model. Exactly one of the
//     two keys is ever present, never both.
//   - the fake key NEVER appears in any value the transport RETURNS or
//     THROWS
//   - non-2xx returns { body: null, status, ...safe provider-error
//     metadata } — the raw body is NEVER returned, only three
//     allowlisted, independently-validated fields may accompany status
//   - a well-formed {error:{type,code,param,message}} envelope yields
//     safe type/code/param, and error.message is NEVER present anywhere
//     in the result
//   - malformed JSON / an unexpected shape / unrecognized values / an
//     oversized or unsafe param all degrade to ABSENT metadata, never a
//     crash and never the raw/unexpected value verbatim
//   - AbortError name preserved (so the adapter maps to PROVIDER_TIMEOUT)
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/adapters/openai-http-transport.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { createOpenAiHttpTransport, isGpt5FamilyModel } = await import("./openai-http-transport.ts");

const FAKE_KEY = "sk-proj-THIS-MUST-NEVER-LEAK";
const PAYLOAD = { model: "gpt-5.6-terra", maxOutputTokens: 512, system: "SYS instruction", userMessage: "<EVIDENCE>\nProspect: X\n</EVIDENCE>" };

function fakeFetch(script) {
  const calls = [];
  const fn = async (url, init) => {
    calls.push({ url, init });
    if (script.reject) throw script.reject;
    const status = script.status ?? 200;
    return {
      status,
      async json() {
        if (script.invalidJson) throw new SyntaxError("Unexpected token < in JSON");
        return script.body ?? { choices: [{ message: { content: "A concise advisory note." } }], usage: { prompt_tokens: 10, completion_tokens: 5 } };
      },
    };
  };
  fn.calls = calls;
  return fn;
}

/** A realistic OpenAI error envelope — the exact shape documented for
 * Chat Completions errors, including the DO-NOT-PROPAGATE message. */
function openAiErrorBody({ type = "invalid_request_error", code = "unsupported_parameter", param = "max_tokens", message = "DO NOT PROPAGATE THIS TEXT" } = {}) {
  return { error: { message, type, param, code } };
}

// ---------------- A-D: outbound request shape ----------------

test("A: GPT-5.6 Terra — outbound request uses max_completion_tokens, NEVER max_tokens, everything else unchanged", async () => {
  const ff = fakeFetch({ status: 200 });
  const t = createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff });
  await t.generate(PAYLOAD); // PAYLOAD.model === "gpt-5.6-terra"
  assert.equal(ff.calls.length, 1);
  const { url, init } = ff.calls[0];
  // D: endpoint unchanged
  assert.equal(url, "https://api.openai.com/v1/chat/completions");
  // B: method
  assert.equal(init.method, "POST");
  // C: headers
  assert.equal(init.headers["content-type"], "application/json");
  assert.ok("Authorization" in init.headers, "an Authorization header is present structurally");
  assert.equal(init.headers["Authorization"], `Bearer ${FAKE_KEY}`);
  assert.ok(init.signal, "an AbortSignal is wired");
  // the fix: max_completion_tokens present, max_tokens ABSENT, model/messages/response_format preserved
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["max_completion_tokens", "messages", "model", "response_format"].sort());
  assert.equal("max_tokens" in body, false, "max_tokens must NOT be sent for a GPT-5-family model");
  assert.equal(body.max_completion_tokens, 512);
  assert.equal(body.model, "gpt-5.6-terra");
  assert.deepEqual(body.messages, [
    { role: "system", content: PAYLOAD.system },
    { role: "user", content: PAYLOAD.userMessage },
  ]);
  assert.deepEqual(body.response_format, { type: "json_object" });
});

test("B: another GPT-5-family identifier (fake, test-only) also gets max_completion_tokens", async () => {
  for (const model of ["gpt-5", "gpt-5-mini", "gpt-5.1-preview", "GPT-5-Turbo"]) {
    const ff = fakeFetch({ status: 200 });
    const t = createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff });
    await t.generate({ ...PAYLOAD, model });
    const body = JSON.parse(ff.calls[0].init.body);
    assert.equal(body.max_completion_tokens, 512, `model ${model}`);
    assert.equal("max_tokens" in body, false, `model ${model}`);
    assert.equal(body.model, model);
  }
});

test("C: a legacy/non-GPT-5 model keeps sending max_tokens — max_completion_tokens absent", async () => {
  for (const model of ["gpt-4o-mini", "gpt-4o", "gpt-4-turbo", "gpt-3.5-turbo", "gpt-50-turbo", "gpt-4.5-preview"]) {
    const ff = fakeFetch({ status: 200 });
    const t = createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff });
    await t.generate({ ...PAYLOAD, model });
    const body = JSON.parse(ff.calls[0].init.body);
    assert.equal(body.max_tokens, 512, `model ${model}`);
    assert.equal("max_completion_tokens" in body, false, `model ${model}`);
    assert.equal(body.model, model);
  }
});

test("isGpt5FamilyModel: the exact predicate — matches gpt-5/gpt-5-*/gpt-5.*, never gpt-50-*/gpt-4.5/unrelated ids", () => {
  for (const model of ["gpt-5", "gpt-5-mini", "gpt-5.6-terra", "GPT-5", "gpt-5-turbo-preview"]) {
    assert.equal(isGpt5FamilyModel(model), true, `expected ${model} to match`);
  }
  for (const model of ["gpt-50-turbo", "gpt-4.5", "gpt-4o", "gpt-4o-mini", "o1", "o3-mini", "", "gpt5", "claude-sonnet-5"]) {
    assert.equal(isGpt5FamilyModel(model), false, `expected ${model} NOT to match`);
  }
});

test("baseUrl / requestTimeoutMs overrides are honored; the fake key never appears in the fake request's URL", async () => {
  const ff = fakeFetch({ status: 200 });
  const t = createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff, baseUrl: "https://proxy.internal/v1/chat/completions", requestTimeoutMs: 5000 });
  await t.generate(PAYLOAD);
  assert.equal(ff.calls[0].url, "https://proxy.internal/v1/chat/completions");
  assert.ok(!ff.calls[0].url.includes(FAKE_KEY));
});

test("200 valid JSON -> { body, status: 200 }, no safe-metadata fields on a success", async () => {
  const ff = fakeFetch({ status: 200, body: { choices: [{ message: { content: "ok" } }] } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { choices: [{ message: { content: "ok" } }] });
  assert.equal("providerErrorType" in res, false);
  assert.equal("providerErrorCode" in res, false);
  assert.equal("providerErrorParam" in res, false);
});

// ---------------- E: realistic non-2xx body -> safe metadata, message excluded ----------------

test("E: HTTP 400 with a realistic OpenAI error envelope -> status=400, safe type/code/param preserved, message NOT present anywhere", async () => {
  const ff = async () => {
    return {
      status: 400,
      async json() {
        return openAiErrorBody();
      },
    };
  };
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal(res.status, 400);
  assert.equal(res.body, null, "the raw body is never returned, even though safe fields are");
  assert.equal(res.providerErrorType, "invalid_request_error");
  assert.equal(res.providerErrorCode, "unsupported_parameter");
  assert.equal(res.providerErrorParam, "max_tokens");
  const s = JSON.stringify(res);
  assert.equal(s.includes("DO NOT PROPAGATE"), false, "error.message must never appear anywhere in the transport result");
  assert.equal(Object.prototype.hasOwnProperty.call(res, "message"), false);
});

for (const status of [401, 403, 429, 500, 502, 503]) {
  test(`E (status sweep): HTTP ${status} with a realistic error envelope -> safe metadata preserved, message excluded, status carried`, async () => {
    const ff = async () => ({ status, async json() { return openAiErrorBody({ type: "rate_limit_error", code: "rate_limit_exceeded", param: null, message: `secret ${FAKE_KEY}` }); } });
    const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
    assert.equal(res.status, status);
    assert.equal(res.body, null);
    assert.equal(res.providerErrorType, "rate_limit_error");
    assert.equal(res.providerErrorCode, "rate_limit_exceeded");
    assert.equal("providerErrorParam" in res, false, "a null param is safely absent, never coerced to a string");
    assert.ok(!JSON.stringify(res).includes(FAKE_KEY));
  });
}

// ---------------- F: malformed JSON error body -> no crash, safe metadata absent, status preserved ----------------

test("F: HTTP 400 with an INVALID JSON error body -> no crash, no throw, safe metadata absent, status preserved", async () => {
  const ff = async () => ({
    status: 400,
    async json() {
      throw new SyntaxError("Unexpected token < in JSON");
    },
  });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal(res.status, 400);
  assert.equal(res.body, null);
  assert.equal("providerErrorType" in res, false);
  assert.equal("providerErrorCode" in res, false);
  assert.equal("providerErrorParam" in res, false);
});

test("F variant: HTTP 500 with a body that isn't an object at all (e.g. a bare string) -> no crash, safe metadata absent", async () => {
  const ff = async () => ({ status: 500, async json() { return "not an object"; } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal(res.status, 500);
  assert.equal(res.body, null);
  assert.equal("providerErrorType" in res, false);
});

test("F variant: HTTP 400 with a JSON body that has NO 'error' key at all -> no crash, safe metadata absent", async () => {
  const ff = async () => ({ status: 400, async json() { return { unexpected: "shape" }; } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal(res.status, 400);
  assert.equal("providerErrorType" in res, false);
  assert.equal("providerErrorCode" in res, false);
  assert.equal("providerErrorParam" in res, false);
});

// ---------------- G: oversized / unsafe metadata -> dropped, never emitted verbatim ----------------

test("G: an oversized param (>64 chars) is dropped, never truncated-and-kept, never emitted verbatim", async () => {
  const oversizedParam = "x".repeat(200);
  const ff = async () => ({ status: 400, async json() { return openAiErrorBody({ param: oversizedParam }); } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal("providerErrorParam" in res, false);
  assert.ok(!JSON.stringify(res).includes(oversizedParam));
});

test("G: a param containing unsafe characters (whitespace / punctuation / a secret-shaped string) is dropped, never emitted verbatim", async () => {
  const hostileParam = `max_tokens; DROP secret=${FAKE_KEY}`;
  const ff = async () => ({ status: 400, async json() { return openAiErrorBody({ param: hostileParam }); } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal("providerErrorParam" in res, false);
  assert.ok(!JSON.stringify(res).includes(hostileParam));
  assert.ok(!JSON.stringify(res).includes(FAKE_KEY));
});

test("G: an oversized type/code string is never a member of the closed set, so it is dropped, never emitted verbatim", async () => {
  const hostileType = "invalid_request_error_" + "x".repeat(500);
  const ff = async () => ({ status: 400, async json() { return openAiErrorBody({ type: hostileType, code: "not_a_real_code_" + FAKE_KEY }); } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal("providerErrorType" in res, false);
  assert.equal("providerErrorCode" in res, false);
  assert.ok(!JSON.stringify(res).includes(FAKE_KEY));
  assert.ok(!JSON.stringify(res).includes(hostileType));
});

// ---------------- H: unrecognized/unknown values -> ignored, closed-set discipline ----------------

test("H: an unrecognized (but well-formed) type/code string outside the closed set is dropped, not passed through", async () => {
  const ff = async () => ({ status: 400, async json() { return openAiErrorBody({ type: "some_future_error_type", code: "some_future_code" }); } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal("providerErrorType" in res, false);
  assert.equal("providerErrorCode" in res, false);
  // param was still well-formed and shape-valid -> kept independently of type/code
  assert.equal(res.providerErrorParam, "max_tokens");
});

test("H: non-string type/code/param values (numbers, objects, arrays, null) are ignored, never coerced", async () => {
  const ff = async () => ({
    status: 400,
    async json() {
      return { error: { type: 12345, code: { nested: "object" }, param: ["array", "value"], message: `secret ${FAKE_KEY}` } };
    },
  });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal("providerErrorType" in res, false);
  assert.equal("providerErrorCode" in res, false);
  assert.equal("providerErrorParam" in res, false);
  assert.ok(!JSON.stringify(res).includes(FAKE_KEY));
});

// ---------------- Step 6: security negative assertions ----------------

test("SECURITY: error.message is never present in the transport result, under any status or shape", async () => {
  for (const status of [400, 401, 403, 429, 500]) {
    const ff = async () => ({ status, async json() { return openAiErrorBody({ message: `unique-marker-${status}-${FAKE_KEY}` }); } });
    const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
    const s = JSON.stringify(res);
    assert.equal(s.includes(`unique-marker-${status}`), false, `status ${status} leaked error.message`);
    assert.equal(s.includes(FAKE_KEY), false);
  }
});

test("SECURITY: the raw error body/object is never present on the transport result — only the three named safe fields", async () => {
  const ff = async () => ({ status: 400, async json() { return openAiErrorBody(); } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.deepEqual(Object.keys(res).sort(), ["body", "providerErrorCode", "providerErrorParam", "providerErrorType", "status"].sort());
  assert.equal(res.body, null);
});

test("SECURITY: the Authorization header value (the fake key) never appears in the RETURNED transport result, on success or failure", async () => {
  const successRes = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: fakeFetch({ status: 200 }) }).generate(PAYLOAD);
  assert.ok(!JSON.stringify(successRes).includes(FAKE_KEY));

  const ff = async () => ({ status: 400, async json() { return openAiErrorBody(); } });
  const failRes = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.ok(!JSON.stringify(failRes).includes(FAKE_KEY));
});

test("SECURITY: the prompt/system instruction and the user evidence message never appear in the transport result", async () => {
  const ff = async () => ({ status: 400, async json() { return openAiErrorBody(); } });
  const res = await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  const s = JSON.stringify(res);
  assert.equal(s.includes(PAYLOAD.system), false);
  assert.equal(s.includes(PAYLOAD.userMessage), false);
  assert.equal(s.includes("Prospect: X"), false);
});

test("SECURITY: a 200 provider response body is returned (unchanged, pre-existing behavior) but never logged by the transport itself — the transport performs no logging at all", async () => {
  const ff = fakeFetch({ status: 200, body: { choices: [{ message: { content: "advisory text" } }] } });
  const logs = [];
  const originalWarn = console.warn;
  const originalLog = console.log;
  console.warn = (...args) => logs.push(args);
  console.log = (...args) => logs.push(args);
  try {
    await createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  } finally {
    console.warn = originalWarn;
    console.log = originalLog;
  }
  assert.equal(logs.length, 0, "the transport itself never logs anything — that is advisory-core's/observability's job, gated separately");
});

// ---------------- pre-existing behavior, unaffected by this mission ----------------

test("200 with invalid JSON -> throws InvalidJsonError, no key/body leak (unaffected by the safe-metadata addition)", async () => {
  const ff = fakeFetch({ status: 200, invalidJson: true });
  const t = createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff });
  await assert.rejects(
    () => t.generate(PAYLOAD),
    (err) => {
      assert.equal(err.name, "InvalidJsonError");
      assert.equal(err.message, "openai transport request failed");
      assert.ok(!String(err.stack).includes(FAKE_KEY));
      return true;
    },
  );
});

test("fetch rejects with AbortError -> re-thrown as AbortError (adapter -> PROVIDER_TIMEOUT); this path never touches safe-metadata extraction", async () => {
  const ff = fakeFetch({ reject: Object.assign(new Error(`aborted ${FAKE_KEY}`), { name: "AbortError" }) });
  await assert.rejects(
    () => createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD),
    (err) => {
      assert.equal(err.name, "AbortError");
      assert.equal(err.message, "openai transport request failed");
      assert.ok(!err.message.includes(FAKE_KEY));
      return true;
    },
  );
});

test("a raw network throw (embedding the key + a body) -> fixed TransportNetworkError, nothing leaks", async () => {
  const ff = fakeFetch({ reject: Object.assign(new Error(`ECONNRESET key=${FAKE_KEY} <html>500</html>`), { name: "FetchError", cause: { code: "ECONNRESET" } }) });
  await assert.rejects(
    () => createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD),
    (err) => {
      assert.equal(err.name, "TransportNetworkError");
      assert.equal(err.message, "openai transport request failed");
      const s = JSON.stringify({ name: err.name, message: err.message }) + String(err.stack ?? "");
      assert.ok(!s.includes(FAKE_KEY));
      assert.ok(!s.includes("<html>"));
      assert.ok(!s.includes("ECONNRESET"));
      return true;
    },
  );
});

test("describeHealth is synthetic (no ping)", () => {
  const t = createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: fakeFetch({ status: 200 }) });
  assert.deepEqual(t.describeHealth(), { reachable: true, degraded: false });
});

test("constructor fails closed on a missing key or missing fetch", () => {
  assert.throws(() => createOpenAiHttpTransport({ apiKey: "", fetchImpl: fakeFetch({}) }), /api key/);
  assert.throws(() => createOpenAiHttpTransport({ apiKey: "   ", fetchImpl: fakeFetch({}) }), /api key/);
  assert.throws(() => createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: 42 }), /fetch/);
});

test("the returned object does NOT expose the key on any property", () => {
  const t = createOpenAiHttpTransport({ apiKey: FAKE_KEY, fetchImpl: fakeFetch({ status: 200 }) });
  assert.ok(!JSON.stringify(Object.keys(t)).includes("apiKey"));
  for (const v of Object.values(t)) assert.ok(typeof v === "function"); // only generate / describeHealth
});
