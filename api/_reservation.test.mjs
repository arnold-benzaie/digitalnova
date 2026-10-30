import { test, describe, beforeEach, afterEach } from "node:test";
import assert from "node:assert/strict";
import handler, { validateReservation, upstreamUrl } from "./reservation.js";

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

function post(body, contentType = "application/json") {
  return new Request("https://example.com/api/reservation", {
    method: "POST",
    headers: { "Content-Type": contentType },
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
