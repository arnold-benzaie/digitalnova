import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler from "./chat-proxy.js";

const ENV_KEYS = ["CHAT_UPSTREAM_URL", "CHAT_PROXY_BYPASS_SECRET"];
let savedEnv;
let savedFetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  savedFetch = globalThis.fetch;
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = savedFetch;
});

function postRequest(body = "{}") {
  return new Request("https://example.com/api/chat-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "visitorId=abc123" },
    body,
  });
}

describe("chat-proxy: no hardcoded Preview URL", () => {
  test("no executable code contains a literal .vercel.app URL (comments may still document one as an example)", () => {
    const source = readFileSync(new URL("./chat-proxy.js", import.meta.url), "utf8");
    // Strip block and line comments first — the header comment legitimately
    // documents an example Preview URL as prose; that's not the bug. What
    // must never reappear is a URL baked into actual, executed code (a
    // const assignment, a fetch() argument, etc.) — the origin must come
    // exclusively from CHAT_UPSTREAM_URL at runtime.
    const codeOnly = source.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*$/gm, "");
    assert.equal(/https?:\/\/[^\s"'`]*\.vercel\.app/i.test(codeOnly), false, "found a hardcoded .vercel.app URL in chat-proxy.js's executable code");
  });

  test("no bare UPSTREAM_URL constant assignment remains", () => {
    const source = readFileSync(new URL("./chat-proxy.js", import.meta.url), "utf8");
    assert.equal(/const\s+UPSTREAM_URL\s*=\s*["'`]/.test(source), false, "found a hardcoded UPSTREAM_URL constant");
  });
});

describe("chat-proxy: CHAT_UPSTREAM_URL present", () => {
  test("forwards to <origin>/api/chat with the request body and headers", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let capturedUrl, capturedInit;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response(JSON.stringify({ reply: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const res = await handler(postRequest('{"type":"message","content":"hi"}'));

    assert.equal(capturedUrl, "https://app.example-preview.vercel.app/api/chat");
    assert.equal(capturedInit.method, "POST");
    assert.equal(capturedInit.headers.Cookie, "visitorId=abc123");
    assert.equal(capturedInit.body, '{"type":"message","content":"hi"}');
    assert.equal(res.status, 200);
  });

  test("strips a trailing slash from CHAT_UPSTREAM_URL before appending /api/chat", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app/";
    let capturedUrl;
    globalThis.fetch = async (url) => {
      capturedUrl = url;
      return new Response("{}", { status: 200 });
    };

    await handler(postRequest());

    assert.equal(capturedUrl, "https://app.example-preview.vercel.app/api/chat");
  });

  test("Preview scenario: bypass secret set -> forwarded as x-vercel-protection-bypass", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app-git-preview-ai-assistant-widget-arnold-benzaies-projects.vercel.app";
    process.env.CHAT_PROXY_BYPASS_SECRET = "preview-bypass-secret-value";
    let capturedInit;
    globalThis.fetch = async (_url, init) => {
      capturedInit = init;
      return new Response(JSON.stringify({ reply: "mock reply" }), { status: 200, headers: { "Content-Type": "application/json" } });
    };

    const res = await handler(postRequest());

    assert.equal(capturedInit.headers["x-vercel-protection-bypass"], "preview-bypass-secret-value");
    assert.equal(res.status, 200);
    const bodyText = await res.text();
    assert.equal(bodyText.includes("preview-bypass-secret-value"), false, "bypass secret leaked into the response body");
  });

  test("Production scenario: no bypass secret configured -> header never added, request still forwards", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.public-map.com";
    // CHAT_PROXY_BYPASS_SECRET intentionally left unset — Production
    // must never depend on it.
    let capturedInit;
    globalThis.fetch = async (_url, init) => {
      capturedInit = init;
      return new Response("{}", { status: 200 });
    };

    await handler(postRequest());

    assert.equal("x-vercel-protection-bypass" in capturedInit.headers, false);
  });

  test("no secret header value ever appears in the response headers sent back to the browser", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    process.env.CHAT_PROXY_BYPASS_SECRET = "super-secret-bypass-value";
    globalThis.fetch = async () => new Response(JSON.stringify({ reply: "ok" }), { status: 200, headers: { "Content-Type": "application/json" } });

    const res = await handler(postRequest());

    for (const [key, value] of res.headers.entries()) {
      assert.equal(value.includes("super-secret-bypass-value"), false, `secret leaked in response header "${key}"`);
    }
  });
});

describe("chat-proxy: CHAT_UPSTREAM_URL absent", () => {
  test("returns a clean 500 with a generic error body, never calls fetch", async () => {
    let fetchCalled = false;
    globalThis.fetch = async () => {
      fetchCalled = true;
      return new Response("{}", { status: 200 });
    };

    const res = await handler(postRequest());

    assert.equal(res.status, 500);
    const body = await res.json();
    assert.deepEqual(body, { error: "proxy_misconfigured" });
    assert.equal(fetchCalled, false, "must never guess an upstream and call fetch when the variable is missing");
  });

  test("logs only the variable name, never a value (there is none, but never a URL either)", async () => {
    const originalError = console.error;
    const logged = [];
    console.error = (...args) => logged.push(args.join(" "));
    try {
      await handler(postRequest());
    } finally {
      console.error = originalError;
    }
    assert.ok(logged.some((line) => line.includes("CHAT_UPSTREAM_URL")), "expected a log line naming the missing variable");
    assert.equal(
      logged.some((line) => /https?:\/\//.test(line)),
      false,
      "log line must never contain a URL",
    );
  });
});

describe("chat-proxy: unrelated behavior unchanged", () => {
  test("non-POST requests are still rejected with 405, before any env check", async () => {
    // No CHAT_UPSTREAM_URL set at all — proves the method check still
    // runs first, matching the original handler's ordering.
    const res = await handler(new Request("https://example.com/api/chat-proxy", { method: "GET" }));
    assert.equal(res.status, 405);
  });

  test("upstream network failure still returns a generic 502, never the raw error", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = async () => {
      throw new Error("ECONNREFUSED at 10.0.0.1 with internal detail");
    };

    const res = await handler(postRequest());

    assert.equal(res.status, 502);
    const body = await res.json();
    assert.deepEqual(body, { error: "proxy_unavailable" });
  });
});
