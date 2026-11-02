import { test, describe, beforeEach, afterEach, mock } from "node:test";
import assert from "node:assert/strict";
import handler, { validateReservation, upstreamUrl, checkRateLimit, clientIp, originAllowed, BODY_READ_TIMEOUT_MS, __resetRateLimits } from "./reservation.js";

const ENV_KEYS = ["RESERVATION_UPSTREAM_URL", "RESERVATION_UPSTREAM_TOKEN"];
let savedEnv;
let savedFetch;
let savedError;

beforeEach(() => {
  savedEnv = Object.fromEntries(ENV_KEYS.map((k) => [k, process.env[k]]));
  for (const k of ENV_KEYS) delete process.env[k];
  savedFetch = globalThis.fetch;
  savedError = console.error;
  console.error = () => {};
  __resetRateLimits();
});

afterEach(() => {
  for (const k of ENV_KEYS) {
    if (savedEnv[k] === undefined) delete process.env[k];
    else process.env[k] = savedEnv[k];
  }
  globalThis.fetch = savedFetch;
  console.error = savedError;
});

function tomorrow() {
  return new Date(Date.now() + 24 * 3600 * 1000).toISOString().slice(0, 10);
}

function validBody(overrides = {}) {
  return {
    fullName: "Test Person", email: "test@example.com", phone: "", company: "Example Ltd", country: "MU",
    service: "website", budget: "to-define", preferredDate: tomorrow(), timeSlot: "morning",
    message: "We would like to discuss a new website for our business.", consent: true, website: "",
    startedAt: Date.now() - 60_000, language: "fr", ...overrides,
  };
}

function post(body, contentType = "application/json", ip) {
  return new Request("https://example.com/api/reservation", {
    method: "POST",
    headers: { "Content-Type": contentType, ...(ip ? { "x-forwarded-for": ip } : {}) },
    body: typeof body === "string" ? body : JSON.stringify(body),
  });
}

describe("reservation: request shape", () => {
  test("rejects GET with 405", async () => {
    const res = await handler(new Request("https://example.com/api/reservation"));
    assert.equal(res.status, 405);
  });

  test("rejects a non-JSON content type", async () => {
    const res = await handler(post("fullName=x", "application/x-www-form-urlencoded"));
    assert.equal(res.status, 400);
    assert.equal((await res.json()).code, "validation_failed");
  });

  test("rejects malformed JSON and oversized bodies", async () => {
    assert.equal((await handler(post("{not json"))).status, 400);
    assert.equal((await handler(post(validBody({ message: "x".repeat(20_000) })))).status, 400);
  });

  test("rejects a declared Content-Length above the limit without reading the body", async () => {
    const req = new Request("https://example.com/api/reservation", {
      method: "POST", headers: { "Content-Type": "application/json", "Content-Length": "999999" }, body: "{}",
    });
    assert.equal((await handler(req)).status, 400);
  });

  test("stops reading a streamed body (no Content-Length) once it exceeds the limit", async () => {
    let pulls = 0;
    const stream = new ReadableStream({
      pull(controller) { pulls++; controller.enqueue(new TextEncoder().encode("x".repeat(4096))); if (pulls > 100) controller.close(); },
    });
    const req = new Request("https://example.com/api/reservation", {
      method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half",
    });
    assert.equal((await handler(req)).status, 400);
    assert.ok(pulls < 10, `read ${pulls} chunks`);
  });
});

describe("reservation: validation mirrors the form", () => {
  test("accepts a complete request", () => {
    assert.ok(validateReservation(validBody()));
  });

  for (const [label, overrides] of [
    ["honeypot filled", { website: "spam" }],
    ["honeypot filled with a non-string", { website: 1 }],
    ["line break in the name (header injection)", { fullName: "Test\r\nBcc: x@example.com" }],
    ["control character in the company", { company: "Example\u0000Ltd" }],
    ["NUL character in the message", { message: "A long enough message\u0000 with a NUL inside." }],
    ["impossible calendar date", { preferredDate: "2027-02-31" }],
    ["date more than a year ahead", { preferredDate: "2099-01-01" }],
    ["sent too fast", { startedAt: Date.now() }],
    ["missing consent", { consent: false }],
    ["bad e-mail", { email: "not-an-email" }],
    ["short message", { message: "too short" }],
    ["unknown country", { country: "XX" }],
    ["unknown service", { service: "payment" }],
    ["unknown budget", { budget: "1m" }],
    ["unknown time slot", { timeSlot: "night" }],
    ["date in the past", { preferredDate: "2020-01-01" }],
    ["name too long", { fullName: "x".repeat(101) }],
  ]) {
    test(`rejects: ${label}`, () => {
      assert.equal(validateReservation(validBody(overrides)), null);
    });
  }

  test("accepts line breaks and tabs in the message only", () => {
    assert.ok(validateReservation(validBody({ message: "First line of the request.\nSecond line\twith a tab." })));
  });

  test("forwards only the expected fields (honeypot and timer dropped)", () => {
    const clean = validateReservation(validBody({ extra: "ignored" }));
    assert.deepEqual(Object.keys(clean).sort(), ["budget", "company", "consent", "country", "email", "fullName", "language",
      "message", "phone", "preferredDate", "service", "timeSlot"]);
  });
});

describe("reservation: backend not configured", () => {
  test("answers 503 reservation_backend_not_configured and never calls fetch", async () => {
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}"); };
    const res = await handler(post(validBody()));
    assert.equal(res.status, 503);
    assert.deepEqual(await res.json(), { ok: false, code: "reservation_backend_not_configured" });
    assert.equal(called, false);
  });

  test("refuses a non-https upstream", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "http://insecure.example.com/hook";
    const res = await handler(post(validBody()));
    assert.equal(res.status, 503);
  });

  test("still rejects invalid input first (400)", async () => {
    const res = await handler(post(validBody({ consent: false })));
    assert.equal(res.status, 400);
  });
});

describe("reservation: destination URL", () => {
  test("accepts only plain https URLs", () => {
    assert.equal(upstreamUrl("https://intake.example.com/hook"), "https://intake.example.com/hook");
    for (const bad of ["", "http://intake.example.com/hook", "https://user:pass@intake.example.com/hook", "not a url", "ftp://x"]) {
      assert.equal(upstreamUrl(bad), null, bad);
    }
  });

  test("refuses a URL with embedded credentials (503, nothing sent)", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "https://user:secret@intake.example.com/hook";
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}"); };
    assert.equal((await handler(post(validBody()))).status, 503);
    assert.equal(called, false);
  });
});

describe("reservation: backend configured", () => {
  test("forwards to the upstream with the optional bearer token and answers ok", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "https://intake.example.com/hook";
    process.env.RESERVATION_UPSTREAM_TOKEN = "secret-token";
    let capturedUrl, capturedInit;
    globalThis.fetch = async (url, init) => {
      capturedUrl = url;
      capturedInit = init;
      return new Response("{}", { status: 200 });
    };
    const res = await handler(post(validBody()));
    assert.equal(res.status, 200);
    assert.deepEqual(await res.json(), { ok: true });
    assert.equal(capturedUrl, "https://intake.example.com/hook");
    assert.equal(capturedInit.headers.Authorization, "Bearer secret-token");
    assert.equal(capturedInit.redirect, "error");
    assert.ok(capturedInit.signal instanceof AbortSignal);
    const sent = JSON.parse(capturedInit.body);
    assert.equal(sent.source, "public-map.com/reservation");
    assert.equal("website" in sent || "startedAt" in sent, false);
  });

  test("maps an upstream error or network failure to 502", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "https://intake.example.com/hook";
    globalThis.fetch = async () => new Response("no", { status: 500 });
    assert.equal((await handler(post(validBody()))).status, 502);
    globalThis.fetch = async () => { throw new DOMException("aborted", "AbortError"); };
    assert.equal((await handler(post(validBody()))).status, 502);
    globalThis.fetch = async () => { throw new TypeError("network"); };
    const res = await handler(post(validBody()));
    assert.equal(res.status, 502);
    assert.equal((await res.json()).code, "reservation_upstream_failed");
  });
});

describe("reservation: rate limiting", () => {
  test("allows 6 POSTs per visitor in 10 minutes, then answers 429 with Retry-After and forwards nothing", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "https://intake.example.com/hook";
    let forwarded = 0;
    globalThis.fetch = async () => { forwarded++; return new Response("{}", { status: 200 }); };
    for (let i = 0; i < 6; i++) assert.equal((await handler(post(validBody(), "application/json", "203.0.113.7"))).status, 200);
    const res = await handler(post(validBody(), "application/json", "203.0.113.7"));
    assert.equal(res.status, 429);
    assert.deepEqual(await res.json(), { ok: false, code: "rate_limited" });
    const retry = Number(res.headers.get("Retry-After"));
    assert.ok(retry > 590 && retry <= 600, `Retry-After ${retry}`);
    assert.equal(forwarded, 6);
  });

  test("counts invalid requests too (a flood of junk cannot be retried for free)", async () => {
    for (let i = 0; i < 6; i++) assert.equal((await handler(post("{junk", "application/json", "203.0.113.8"))).status, 400);
    assert.equal((await handler(post(validBody(), "application/json", "203.0.113.8"))).status, 429);
  });

  test("one visitor being limited never blocks another visitor", async () => {
    for (let i = 0; i < 7; i++) await handler(post("{junk", "application/json", "203.0.113.9"));
    assert.equal((await handler(post(validBody(), "application/json", "198.51.100.1"))).status, 503);
  });

  test("a legitimate visitor who retries a few times after an error is not blocked", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "https://intake.example.com/hook";
    globalThis.fetch = async () => new Response("down", { status: 500 });
    for (let i = 0; i < 3; i++) assert.equal((await handler(post(validBody(), "application/json", "192.0.2.10"))).status, 502);
    globalThis.fetch = async () => new Response("{}", { status: 200 });
    assert.equal((await handler(post(validBody(), "application/json", "192.0.2.10"))).status, 200);
  });

  test("GET requests are refused (405) without consuming the quota", async () => {
    for (let i = 0; i < 10; i++) {
      await handler(new Request("https://example.com/api/reservation", { headers: { "x-forwarded-for": "192.0.2.20" } }));
    }
    assert.equal((await handler(post(validBody(), "application/json", "192.0.2.20"))).status, 503);
  });

  test("the window slides: a limited visitor is allowed again after 10 minutes", () => {
    const t0 = 1_800_000_000_000;
    for (let i = 0; i < 6; i++) assert.equal(checkRateLimit("192.0.2.30", t0 + i).limited, false);
    assert.equal(checkRateLimit("192.0.2.30", t0 + 1000).limited, true);
    assert.equal(checkRateLimit("192.0.2.30", t0 + 10 * 60 * 1000 + 10).limited, false);
  });

  test("a global cap of 60 POSTs per minute protects the intake from many IPs", () => {
    const t0 = 1_900_000_000_000;
    for (let i = 0; i < 60; i++) assert.equal(checkRateLimit(`10.0.${Math.floor(i / 250)}.${i % 250}`, t0).limited, false);
    const over = checkRateLimit("10.9.9.9", t0 + 5);
    assert.equal(over.limited, true);
    assert.ok(over.retryAfterSec >= 59 && over.retryAfterSec <= 60);
    assert.equal(checkRateLimit("10.9.9.9", t0 + 60_001).limited, false);
  });

  test("reads the first x-forwarded-for address and ignores malformed values", () => {
    const req = (h) => new Request("https://example.com/", { headers: h });
    assert.equal(clientIp(req({ "x-forwarded-for": "203.0.113.5, 10.0.0.1" })), "203.0.113.5");
    assert.equal(clientIp(req({ "x-real-ip": "2001:db8::1" })), "2001:db8::1");
    assert.equal(clientIp(req({ "x-forwarded-for": "<script>" })), "unknown");
    assert.equal(clientIp(req({})), "unknown");
  });
});

describe("reservation: origin check", () => {
  const withOrigin = (origin, body = validBody()) => new Request("https://www.public-map.com/api/reservation", {
    method: "POST",
    headers: { "Content-Type": "application/json", ...(origin === undefined ? {} : { origin }) },
    body: JSON.stringify(body),
  });

  test("a foreign Origin gets 403 origin_not_allowed and nothing is sent", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "https://intake.example.com/hook";
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
    const res = await handler(withOrigin("https://evil.example"));
    assert.equal(res.status, 403);
    assert.deepEqual(await res.json(), { ok: false, code: "origin_not_allowed" });
    assert.equal(res.headers.get("Cache-Control"), "no-store");
    assert.equal(called, false);
  });

  test("the site's own origin and requests without Origin go on to the usual checks", async () => {
    for (const origin of ["https://www.public-map.com", "https://public-map.com", "https://digitalnova-l66m407h4-arnold-benzaies-projects.vercel.app", undefined]) {
      __resetRateLimits();
      const res = await handler(withOrigin(origin));
      assert.equal(res.status, 503, String(origin));
      assert.equal((await res.json()).code, "reservation_backend_not_configured");
    }
  });

  test("look-alike and opaque origins are refused", () => {
    const req = (o) => new Request("https://www.public-map.com/api/reservation", { method: "POST", headers: { origin: o } });
    for (const o of ["null", "http://www.public-map.com", "https://www.public-map.com.evil.example", "https://evil-arnold-benzaies-projects.vercel.app"]) {
      assert.equal(originAllowed(req(o)), false, o);
    }
  });

  test("refused origins still consume the rate-limit quota (checked first)", async () => {
    for (let i = 0; i < 6; i++) assert.equal((await handler(post(validBody(), "application/json", "203.0.113.40"))).status, 503);
    const res = await handler(new Request("https://www.public-map.com/api/reservation", {
      method: "POST", headers: { "Content-Type": "application/json", origin: "https://evil.example", "x-forwarded-for": "203.0.113.40" }, body: "{}",
    }));
    assert.equal(res.status, 429);
  });
});

describe("reservation: body read deadline (10 s)", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));
  const enc = (s) => new TextEncoder().encode(s);
  const slow = (stream) => new Request("https://example.com/api/reservation", { method: "POST", headers: { "Content-Type": "application/json" }, body: stream, duplex: "half" });

  test("the limit is 10 seconds", () => {
    assert.equal(BODY_READ_TIMEOUT_MS, 10000);
  });

  test("a body that never finishes gets 408 request_timeout at 10 s, and nothing is sent", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "https://intake.example.com/hook";
    let called = false;
    globalThis.fetch = async () => { called = true; return new Response("{}", { status: 200 }); };
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = handler(slow(new ReadableStream({ start(c) { c.enqueue(enc('{"fullName":')); } })));
      await flush();
      let settled = false;
      pending.then(() => { settled = true; });
      mock.timers.tick(BODY_READ_TIMEOUT_MS - 1);
      await flush();
      assert.equal(settled, false, "must still be waiting just before 10 s");
      mock.timers.tick(1);
      const res = await pending;
      assert.equal(res.status, 408);
      assert.deepEqual(await res.json(), { ok: false, code: "request_timeout" });
      assert.equal(res.headers.get("Cache-Control"), "no-store");
      assert.equal(called, false);
    } finally {
      mock.timers.reset();
    }
  });

  test("a body completed in 9 s is processed normally", async () => {
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const text = JSON.stringify(validBody());
      const stream = new ReadableStream({
        start(c) {
          c.enqueue(enc(text.slice(0, 10)));
          setTimeout(() => { c.enqueue(enc(text.slice(10))); c.close(); }, 9000);
        },
      });
      const pending = handler(slow(stream));
      await flush();
      mock.timers.tick(9000);
      const res = await pending;
      assert.equal(res.status, 503);
      assert.equal((await res.json()).code, "reservation_backend_not_configured");
    } finally {
      mock.timers.reset();
    }
  });
});

describe("reservation: existing protections preserved", () => {
  const flush = () => new Promise((resolve) => setImmediate(resolve));

  test("the upstream gets 8 seconds, then the request is aborted and answered 502", async () => {
    process.env.RESERVATION_UPSTREAM_URL = "https://intake.example.com/hook";
    globalThis.fetch = (url, init) => new Promise((_resolve, reject) => {
      init.signal.addEventListener("abort", () => reject(new DOMException("aborted", "AbortError")));
    });
    mock.timers.enable({ apis: ["setTimeout"] });
    try {
      const pending = handler(post(validBody()));
      await flush();
      await flush();
      let settled = false;
      pending.then(() => { settled = true; });
      mock.timers.tick(7999);
      await flush();
      assert.equal(settled, false, "must still be waiting just before 8 s");
      mock.timers.tick(1);
      const res = await pending;
      assert.equal(res.status, 502);
      assert.equal((await res.json()).code, "reservation_upstream_failed");
    } finally {
      mock.timers.reset();
    }
  });

  test("no personal data ever appears in the logs", async () => {
    const logged = [];
    console.error = (...args) => logged.push(args.join(" "));
    const body = validBody({ fullName: "Jeanne Exemple", email: "jeanne.exemple@example.com", phone: "+230 5555 1234", company: "Société Exemple" });
    await handler(post(body));                                   // 503 not configured
    process.env.RESERVATION_UPSTREAM_URL = "https://intake.example.com/hook";
    globalThis.fetch = async () => new Response("no", { status: 500 });
    await handler(post(body));                                   // 502 upstream error
    globalThis.fetch = async () => { throw new TypeError("network"); };
    await handler(post(body));                                   // 502 network
    for (let i = 0; i < 6; i++) await handler(post(body, "application/json", "203.0.113.77"));
    await handler(post(body, "application/json", "203.0.113.77")); // 429
    assert.ok(logged.length >= 4, "the failures above are logged");
    for (const secret of ["Jeanne", "jeanne.exemple", "5555", "Société", "intake.example.com"]) {
      assert.equal(logged.some((line) => line.includes(secret)), false, `"${secret}" leaked into a log line`);
    }
  });

  test("honeypot, fill time, 16 KB cap, JSON and https upstream still answer as before", async () => {
    assert.equal((await handler(post(validBody({ website: "spam" })))).status, 400);
    assert.equal((await handler(post(validBody({ startedAt: Date.now() })))).status, 400);
    assert.equal((await handler(post("x".repeat(16 * 1024 + 1)))).status, 400);
    assert.equal((await handler(post("{not json"))).status, 400);
    process.env.RESERVATION_UPSTREAM_URL = "http://intake.example.com/hook";
    assert.equal((await handler(post(validBody()))).status, 503);
  });
});
