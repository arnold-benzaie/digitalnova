import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import handler, { UPSTREAM_TIMEOUT_MS, MAX_BODY_BYTES, VISITOR_COOKIE, checkRateLimit, clientIp, originAllowed, visitorCookie, __resetRateLimits } from "./chat-proxy.js";

const ENV_KEYS = ["CHAT_UPSTREAM_URL", "CHAT_PROXY_BYPASS_SECRET"];
let savedEnv;
let savedFetch;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  savedFetch = globalThis.fetch;
  __resetRateLimits();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = savedFetch;
});

function postRequest(body = "{}", extraHeaders = {}) {
  return new Request("https://example.com/api/chat-proxy", {
    method: "POST",
    headers: { "Content-Type": "application/json", cookie: "_ga=GA1.1.123.456; pm_chat_visitor_id=abc123; theme=dark", ...extraHeaders },
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
    assert.equal(capturedInit.headers.Cookie, "pm_chat_visitor_id=abc123");
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

describe("chat-proxy: rate limiting (per instance)", () => {
  const ip = (n) => ({ "x-forwarded-for": `203.0.113.${n}` });

  test("30 POSTs per IP in 5 minutes are forwarded, the 31st gets 429 with Retry-After and is not forwarded", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 200 }); };
    for (let i = 0; i < 30; i++) assert.equal((await handler(postRequest("{}", ip(7)))).status, 200);
    const res = await handler(postRequest("{}", ip(7)));
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { error: "rate_limited" });
    const retry = Number(res.headers.get("Retry-After"));
    assert.ok(Number.isInteger(retry) && retry > 0 && retry <= 300, `Retry-After was ${res.headers.get("Retry-After")}`);
    assert.equal(calls, 30, "the limited request must never reach the app");
  });

  test("one limited IP never blocks another one", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    for (let i = 0; i < 31; i++) await handler(postRequest("{}", ip(8)));
    assert.equal((await handler(postRequest("{}", ip(9)))).status, 200);
  });

  test("the window slides: allowed again 5 minutes later", () => {
    const t0 = 1_000_000;
    for (let i = 0; i < 30; i++) assert.equal(checkRateLimit("198.51.100.1", t0).limited, false);
    assert.equal(checkRateLimit("198.51.100.1", t0 + 1000).limited, true);
    assert.equal(checkRateLimit("198.51.100.1", t0 + 5 * 60 * 1000).limited, false);
  });

  test("a global cap of 300 POSTs per minute holds across many IPs", () => {
    const t0 = 2_000_000;
    for (let i = 0; i < 300; i++) assert.equal(checkRateLimit(`10.0.${Math.floor(i / 250)}.${i % 250}`, t0).limited, false);
    const over = checkRateLimit("10.9.9.9", t0 + 10);
    assert.equal(over.limited, true);
    assert.ok(over.retryAfterSec > 0 && over.retryAfterSec <= 60);
    assert.equal(checkRateLimit("10.9.9.9", t0 + 60 * 1000).limited, false);
  });

  test("refused requests count too (403 from a foreign origin uses the same quota)", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    for (let i = 0; i < 30; i++) assert.equal((await handler(postRequest("{}", { ...ip(10), origin: "https://evil.example" }))).status, 403);
    assert.equal((await handler(postRequest("{}", ip(10)))).status, 429);
  });

  test("OPTIONS and GET are refused (405) without consuming the quota or calling the app", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let calls = 0;
    globalThis.fetch = async () => { calls += 1; return new Response("{}", { status: 200 }); };
    for (let i = 0; i < 40; i++) {
      const res = await handler(new Request("https://example.com/api/chat-proxy", { method: i % 2 ? "OPTIONS" : "GET", headers: { ...ip(11), origin: "https://evil.example", "access-control-request-method": "POST" } }));
      assert.equal(res.status, 405);
      assert.equal(res.headers.get("access-control-allow-origin"), null, "no CORS permission is ever granted");
    }
    assert.equal(calls, 0);
    assert.equal((await handler(postRequest("{}", ip(11)))).status, 200);
  });

  test("reads the first x-forwarded-for address and ignores malformed values", () => {
    const req = (h) => new Request("https://example.com/api/chat-proxy", { headers: h });
    assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })), "203.0.113.5");
    assert.equal(clientIp(req({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
    assert.equal(clientIp(req({ "x-forwarded-for": "<script>" })), "unknown");
    assert.equal(clientIp(req({})), "unknown");
  });
});

describe("chat-proxy: origin check", () => {
  const withOrigin = (origin) => new Request("https://digitalnova-abc123-arnold-benzaies-projects.vercel.app/api/chat-proxy", { method: "POST", headers: origin === undefined ? {} : { origin } });

  test("a foreign Origin gets 403 and the app is never called", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
    const res = await handler(postRequest("{}", { origin: "https://evil.example" }));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { error: "origin_not_allowed" });
    assert.equal(called, false);
  });

  test("no Origin header (non-browser client) is let through", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = async () => new Response('{"reply":"ok"}', { status: 200, headers: { "Content-Type": "application/json" } });
    const res = await handler(postRequest("{}"));
    assert.equal(res.status, 200);
    assert.equal(originAllowed(withOrigin(undefined)), true);
  });

  test("the site's own origins are accepted", () => {
    for (const o of [
      "https://digitalnova-abc123-arnold-benzaies-projects.vercel.app", // the origin the request was sent to
      "https://www.public-map.com",
      "https://public-map.com",
      "https://digitalnova-kohl.vercel.app",
      "https://digitalnova-arnold-benzaies-projects.vercel.app",
      "https://digitalnova-l66m407h4-arnold-benzaies-projects.vercel.app",
      "https://digitalnova-git-fix-sbm-website-bad23c-arnold-benzaies-projects.vercel.app",
    ]) assert.equal(originAllowed(withOrigin(o)), true, o);
  });

  test("look-alike, insecure and opaque origins are refused", () => {
    for (const o of [
      "null",
      "http://www.public-map.com",
      "https://www.public-map.com.evil.example",
      "https://evil-public-map.com",
      "https://evil-arnold-benzaies-projects.vercel.app",
      "https://app-arnold-benzaies-projects.vercel.app",
      "https://digitalnova-x-arnold-benzaies-projects.vercel.app.evil.example",
      "https://digitalnova-x-arnold-benzaies-projects.vercel.app:8443",
    ]) assert.equal(originAllowed(withOrigin(o)), false, o);
  });
});

describe("chat-proxy: request body", () => {
  const enc = (s) => new TextEncoder().encode(s);

  test("a non-JSON content type gets 415 and is not forwarded", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
    const res = await handler(postRequest("{}", { "Content-Type": "text/plain" }));
    assert.equal(res.status, 415);
    assert.deepEqual(await res.json(), { error: "unsupported_media_type" });
    const noType = await handler(new Request("https://example.com/api/chat-proxy", { method: "POST", body: enc("{}") }));
    assert.equal(noType.status, 415);
    assert.equal(called, false);
  });

  test("a JSON content type with a charset is accepted", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    assert.equal((await handler(postRequest("{}", { "Content-Type": "application/json; charset=utf-8" }))).status, 200);
  });

  test("a body that is not JSON gets 400 invalid_json and is not forwarded", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
    for (const body of ["{not json", ""]) {
      const res = await handler(postRequest(body));
      assert.equal(res.status, 400);
      assert.deepEqual(await res.json(), { error: "invalid_json" });
    }
    assert.equal(called, false);
  });

  test("a declared Content-Length above 32 KB gets 413 without reading the body", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let read = false;
    const fake = {
      method: "POST",
      url: "https://example.com/api/chat-proxy",
      headers: new Headers({ "content-type": "application/json", "content-length": String(MAX_BODY_BYTES + 1) }),
      get body() { read = true; return null; },
    };
    const res = await handler(fake);
    assert.equal(res.status, 413);
    assert.deepEqual(await res.json(), { error: "payload_too_large" });
    assert.equal(read, false);
  });

  test("a streamed body over 32 KB (no Content-Length) gets 413 and is not forwarded", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
    const chunk = enc(`"${"x".repeat(1022)}",`);
    let sent = 0;
    const stream = new ReadableStream({
      pull(controller) {
        if (sent === 0) controller.enqueue(enc("["));
        controller.enqueue(chunk);
        sent += 1;
        if (sent > 40) controller.close();
      },
    });
    const res = await handler(new Request("https://example.com/api/chat-proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" }));
    assert.equal(res.status, 413);
    assert.equal(called, false);
  });

  test("a body of exactly 32 KB is still forwarded", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let forwarded;
    globalThis.fetch = async (_url, init) => { forwarded = init.body; return new Response("{}", { status: 200 }); };
    const body = JSON.stringify({ content: "" });
    const full = JSON.stringify({ content: "y".repeat(MAX_BODY_BYTES - body.length) });
    assert.equal(enc(full).byteLength, MAX_BODY_BYTES);
    assert.equal((await handler(postRequest(full))).status, 200);
    assert.equal(forwarded, full);
  });
});

describe("chat-proxy: one 18 s deadline covers the body too", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const enc = (s) => new TextEncoder().encode(s);
  const slowRequest = (stream) => new Request("https://example.com/api/chat-proxy", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" });

  test("a body that never finishes gets 408 request_timeout at 18 s, and the app is never called", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = handler(slowRequest(new ReadableStream({ start(c) { c.enqueue(enc('{"type":')); } })));
      await flush();
      let settled = false;
      pending.then(() => { settled = true; });
      mock.timers.tick(UPSTREAM_TIMEOUT_MS - 1);
      await flush();
      assert.equal(settled, false, "must still be waiting just before 18 s");
      mock.timers.tick(1);
      const res = await pending;
      assert.equal(res.status, 408);
      assert.deepEqual(await res.json(), { error: "request_timeout" });
      assert.equal(res.headers.get("Cache-Control"), "no-store");
      assert.equal(called, false);
    } finally {
      mock.timers.reset();
    }
  });

  test("10 s spent on the body leave only 8 s for the app: 504 at 18 s in total, not 28 s", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = (url, init) => new Promise((resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(Object.assign(new Error("aborted"), { name: "AbortError" })));
    });
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(enc('{"type":'));
          setTimeout(() => { c.enqueue(enc('"message"}')); c.close(); }, 10000);
        },
      });
      const pending = handler(slowRequest(stream));
      await flush();
      mock.timers.tick(10000);
      await flush();
      await flush();
      let settled = false;
      pending.then(() => { settled = true; });
      mock.timers.tick(UPSTREAM_TIMEOUT_MS - 10000 - 1);
      await flush();
      assert.equal(settled, false, "must still be waiting just before 18 s in total");
      mock.timers.tick(1);
      const res = await pending;
      assert.equal(res.status, 504);
      assert.deepEqual(await res.json(), { error: "proxy_timeout" });
    } finally {
      mock.timers.reset();
    }
  });
});

describe("chat-proxy: cookies forwarded to the app", () => {
  test("only pm_chat_visitor_id is forwarded, never the site's other cookies", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let headers;
    globalThis.fetch = async (_url, init) => { headers = init.headers; return new Response("{}", { status: 200 }); };
    await handler(postRequest("{}", { cookie: "_ga=GA1.1.1.2; _ga_DSRTDWQ0P2=GS1.1; pm_chat_visitor_id=v-42; xpm_chat_visitor_id=bad; pm_chat_visitor_id_old=old" }));
    assert.equal(headers.Cookie, "pm_chat_visitor_id=v-42");
  });

  test("no Cookie header at all when the visitor cookie is absent", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    let headers;
    globalThis.fetch = async (_url, init) => { headers = init.headers; return new Response("{}", { status: 200 }); };
    await handler(postRequest("{}", { cookie: "_ga=GA1.1.1.2; theme=dark" }));
    assert.equal("Cookie" in headers, false);
    assert.equal(visitorCookie(null), null);
    assert.equal(visitorCookie(""), null);
    assert.equal(VISITOR_COOKIE, "pm_chat_visitor_id");
  });

  test("the app's Set-Cookie still reaches the browser", async () => {
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    globalThis.fetch = async () => new Response("{}", { status: 200, headers: { "Set-Cookie": "pm_chat_visitor_id=new; Path=/; HttpOnly; Secure; SameSite=Lax" } });
    const res = await handler(postRequest("{}"));
    assert.match(res.headers.get("set-cookie") || "", /^pm_chat_visitor_id=new/);
  });
});

describe("chat-proxy: Cache-Control: no-store on every response", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  test("errors, refusals and relayed answers all carry no-store", async () => {
    const cases = [];
    cases.push(["405", await handler(new Request("https://example.com/api/chat-proxy", { method: "GET" }))]);
    cases.push(["500", await handler(postRequest("{}"))]);
    process.env.CHAT_UPSTREAM_URL = "https://app.example-preview.vercel.app";
    cases.push(["403", await handler(postRequest("{}", { origin: "https://evil.example" }))]);
    cases.push(["415", await handler(postRequest("{}", { "Content-Type": "text/plain" }))]);
    cases.push(["400", await handler(postRequest("{x"))]);
    cases.push(["413", await handler({ method: "POST", url: "https://example.com/api/chat-proxy", headers: new Headers({ "content-type": "application/json", "content-length": "999999" }), body: null })]);
    globalThis.fetch = async () => { throw new TypeError("network"); };
    cases.push(["502", await handler(postRequest("{}"))]);
    globalThis.fetch = async () => new Response('{"reply":"ok"}', { status: 200, headers: { "Content-Type": "application/json", "Cache-Control": "public, max-age=600" } });
    cases.push(["200 relayed", await handler(postRequest("{}"))]);
    globalThis.fetch = (url, init) => new Promise((_r, reject) => init.signal.addEventListener("abort", () => reject(Object.assign(new Error("a"), { name: "AbortError" }))));
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = handler(postRequest("{}"));
      await flush();
      mock.timers.tick(UPSTREAM_TIMEOUT_MS);
      cases.push(["504", await pending]);
    } finally {
      mock.timers.reset();
    }
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    for (let i = 0; i < 30; i++) await handler(postRequest("{}", { "x-forwarded-for": "192.0.2.99" }));
    cases.push(["429", await handler(postRequest("{}", { "x-forwarded-for": "192.0.2.99" }))]);
    for (const [label, res] of cases) {
      assert.equal(res.headers.get("Cache-Control"), "no-store", `${label} (status ${res.status})`);
      assert.equal(String(res.status), label.split(" ")[0], `${label} status`);
    }
  });
});
