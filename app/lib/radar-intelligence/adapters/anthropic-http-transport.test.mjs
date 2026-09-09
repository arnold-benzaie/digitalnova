// RADAR INTELLIGENCE V1 — Slice 3 — real Anthropic HTTP transport unit tests.
//
// ZERO network: an injected fake `fetch` simulates 200 / 400 / 401 / 429 /
// 500 / 503 / invalid-JSON / AbortError / network-throw. Proves:
//   - exact outbound request: URL, POST, content-type, anthropic-version,
//     and x-api-key = the fake key IN THE FAKE REQUEST
//   - the fake key NEVER appears in any value the transport RETURNS or
//     THROWS
//   - non-2xx returns { body: null, status } (body not read/propagated)
//   - invalid JSON / network throw -> fixed generic errors
//   - AbortError name preserved (so the adapter maps to PROVIDER_TIMEOUT)
//
// Run: npx tsx --test --experimental-test-module-mocks lib/radar-intelligence/adapters/anthropic-http-transport.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { createAnthropicHttpTransport } = await import("./anthropic-http-transport.ts");

const FAKE_KEY = "sk-ant-THIS-MUST-NEVER-LEAK";
const PAYLOAD = { model: "claude-sonnet-4-5", maxOutputTokens: 512, system: "SYS instruction", userMessage: "<EVIDENCE>\nProspect: X\n</EVIDENCE>" };

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
        return script.body ?? { content: [{ type: "text", text: "A concise advisory note." }], usage: { input_tokens: 10, output_tokens: 5 } };
      },
    };
  };
  fn.calls = calls;
  return fn;
}

test("transport: outbound request shape — URL, method, headers (x-api-key = the key), Messages body", async () => {
  const ff = fakeFetch({ status: 200 });
  const t = createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff });
  await t.generate(PAYLOAD);
  assert.equal(ff.calls.length, 1);
  const { url, init } = ff.calls[0];
  assert.equal(url, "https://api.anthropic.com/v1/messages");
  assert.equal(init.method, "POST");
  assert.equal(init.headers["content-type"], "application/json");
  assert.equal(init.headers["anthropic-version"], "2023-06-01");
  assert.equal(init.headers["x-api-key"], FAKE_KEY, "the key IS sent on the request header");
  assert.ok(init.signal, "an AbortSignal is wired");
  const body = JSON.parse(init.body);
  assert.deepEqual(Object.keys(body).sort(), ["max_tokens", "messages", "model", "system"].sort());
  assert.equal(body.model, "claude-sonnet-4-5");
  assert.equal(body.max_tokens, 512);
  assert.deepEqual(body.messages, [{ role: "user", content: PAYLOAD.userMessage }]);
});

test("transport: baseUrl / anthropicVersion overrides are honored", async () => {
  const ff = fakeFetch({ status: 200 });
  const t = createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff, baseUrl: "https://proxy.internal/v1/messages", anthropicVersion: "2099-01-01" });
  await t.generate(PAYLOAD);
  assert.equal(ff.calls[0].url, "https://proxy.internal/v1/messages");
  assert.equal(ff.calls[0].init.headers["anthropic-version"], "2099-01-01");
});

test("transport: 200 valid JSON -> { body, status: 200 }", async () => {
  const ff = fakeFetch({ status: 200, body: { content: [{ type: "text", text: "ok" }] } });
  const res = await createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
  assert.equal(res.status, 200);
  assert.deepEqual(res.body, { content: [{ type: "text", text: "ok" }] });
});

for (const status of [400, 401, 403, 429, 500, 502, 503, 504]) {
  test(`transport: HTTP ${status} -> { body: null, status } (error body NOT read)`, async () => {
    let jsonCalled = false;
    const ff = async () => ({
      status,
      async json() {
        jsonCalled = true;
        return { error: { message: `secret ${FAKE_KEY}` } };
      },
    });
    const res = await createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD);
    assert.deepEqual(res, { body: null, status });
    assert.equal(jsonCalled, false, "the error response body is never parsed");
    assert.ok(!JSON.stringify(res).includes(FAKE_KEY));
  });
}

test("transport: 200 with invalid JSON -> throws InvalidJsonError, no key/body leak", async () => {
  const ff = fakeFetch({ status: 200, invalidJson: true });
  const t = createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff });
  await assert.rejects(
    () => t.generate(PAYLOAD),
    (err) => {
      assert.equal(err.name, "InvalidJsonError");
      assert.equal(err.message, "anthropic transport request failed");
      assert.ok(!String(err.stack).includes(FAKE_KEY));
      return true;
    },
  );
});

test("transport: fetch rejects with AbortError -> re-thrown as AbortError (adapter -> PROVIDER_TIMEOUT)", async () => {
  const ff = fakeFetch({ reject: Object.assign(new Error(`aborted ${FAKE_KEY}`), { name: "AbortError" }) });
  await assert.rejects(
    () => createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD),
    (err) => {
      assert.equal(err.name, "AbortError");
      assert.equal(err.message, "anthropic transport request failed");
      assert.ok(!err.message.includes(FAKE_KEY));
      return true;
    },
  );
});

test("transport: a raw network throw (embedding the key + a body) -> fixed TransportNetworkError, nothing leaks", async () => {
  const ff = fakeFetch({ reject: Object.assign(new Error(`ECONNRESET key=${FAKE_KEY} <html>500</html>`), { name: "FetchError", cause: { code: "ECONNRESET" } }) });
  await assert.rejects(
    () => createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: ff }).generate(PAYLOAD),
    (err) => {
      assert.equal(err.name, "TransportNetworkError");
      assert.equal(err.message, "anthropic transport request failed");
      const s = JSON.stringify({ name: err.name, message: err.message }) + String(err.stack ?? "");
      assert.ok(!s.includes(FAKE_KEY));
      assert.ok(!s.includes("<html>"));
      assert.ok(!s.includes("ECONNRESET"));
      return true;
    },
  );
});

test("transport: describeHealth is synthetic (no ping)", () => {
  const t = createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: fakeFetch({ status: 200 }) });
  assert.deepEqual(t.describeHealth(), { reachable: true, degraded: false });
});

test("transport: constructor fails closed on a missing key or missing fetch", () => {
  assert.throws(() => createAnthropicHttpTransport({ apiKey: "", fetchImpl: fakeFetch({}) }), /api key/);
  assert.throws(() => createAnthropicHttpTransport({ apiKey: "   ", fetchImpl: fakeFetch({}) }), /api key/);
  assert.throws(() => createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: 42 }), /fetch/);
});

test("transport: the returned object does NOT expose the key on any property", () => {
  const t = createAnthropicHttpTransport({ apiKey: FAKE_KEY, fetchImpl: fakeFetch({ status: 200 }) });
  assert.ok(!JSON.stringify(Object.keys(t)).includes("apiKey"));
  for (const v of Object.values(t)) assert.ok(typeof v === "function"); // only generate / describeHealth
});
