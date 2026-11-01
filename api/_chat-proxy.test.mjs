import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler, { UPSTREAM_TIMEOUT_MS } from "./chat-proxy.js";

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

describe("chat-proxy: upstream timeout (18 s)", () => {
  // A fetch that never settles on its own, but rejects like the real fetch when its signal aborts.
  // Lets the handler run up to its next await (it reads the request body before arming the timer).
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  function hangingFetch() {
    return (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
  }

  test("the limit is 18 seconds", () => {
    assert.equal(UPSTREAM_TIMEOUT_MS, 18000);
  });

  test("an upstream that never answers gets a clean 504 proxy_timeout after 18 s", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = hangingFetch();
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = handler(postRequest('{"type":"message","content":"test"}'));
      await flush();
      mock.timers.tick(UPSTREAM_TIMEOUT_MS - 1);
      let settled = false;
      pending.then(() => { settled = true; });
      await flush();
      assert.equal(settled, false, "must still be waiting just before 18 s");
      mock.timers.tick(1);
      const res = await pending;
      assert.equal(res.status, 504);
      assert.deepEqual(await res.json(), { error: "proxy_timeout" });
    } finally {
      mock.timers.reset();
    }
  });

  test("headers received but body never completes: also 504 proxy_timeout", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = (url, init) => Promise.resolve({
      status: 200,
      headers: new Headers({ "content-type": "application/json" }),
      text: () => new Promise((resolve, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })))),
    });
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = handler(postRequest("{}"));
      await flush();
      mock.timers.tick(UPSTREAM_TIMEOUT_MS);
      const res = await pending;
      assert.equal(res.status, 504);
      assert.deepEqual(await res.json(), { error: "proxy_timeout" });
    } finally {
      mock.timers.reset();
    }
  });

  test("a timely answer is relayed unchanged and the timer is cleared", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let signal;
    globalThis.fetch = async (url, init) => { signal = init.signal; return new Response('{"reply":"ok"}', { status: 200, headers: { "Content-Type": "application/json" } }); };
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const res = await handler(postRequest("{}"));
      mock.timers.tick(UPSTREAM_TIMEOUT_MS * 2);
      assert.equal(res.status, 200);
      assert.equal(await res.text(), '{"reply":"ok"}');
      assert.equal(signal.aborted, false, "the timer must not fire after a successful answer");
    } finally {
      mock.timers.reset();
    }
  });

  test("the timeout response exposes no upstream URL or secret", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    process.env.CHAT_PROXY_BYPASS_SECRET = "secret-value-for-test";
    globalThis.fetch = hangingFetch();
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = handler(postRequest("{}"));
      await flush();
      mock.timers.tick(UPSTREAM_TIMEOUT_MS);
      const res = await pending;
      const text = await res.text();
      assert.equal(text.includes("example-preview"), false);
      assert.equal(text.includes("secret-value-for-test"), false);
      assert.equal([...res.headers.keys()].some((k) => k.includes("bypass")), false);
    } finally {
      mock.timers.reset();
    }
  });
});
