import { test } from "node:test";
import assert from "node:assert/strict";
import { PublicMapClient } from "./client.js";
import { PublicMapApiError } from "./errors.js";

function fakeFetch(handler: (url: string, init: RequestInit) => { status: number; body: unknown; headers?: Record<string, string> }) {
  return (async (input: string | URL | Request, init?: RequestInit) => {
    const url = typeof input === "string" ? input : input.toString();
    const { status, body, headers } = handler(url, init ?? {});
    return new Response(JSON.stringify(body), { status, headers });
  }) as typeof fetch;
}

test("PublicMapClient: constructor requires an apiKey", () => {
  assert.throws(() => new PublicMapClient({ apiKey: "" }), /requires an apiKey/);
});

test("ping: sends Authorization: Bearer and returns the parsed data envelope", async () => {
  let capturedUrl = "";
  let capturedAuth: string | undefined;
  const client = new PublicMapClient({
    apiKey: "pm_live_test",
    fetch: fakeFetch((url, init) => {
      capturedUrl = url;
      capturedAuth = (init.headers as Record<string, string>).Authorization;
      return { status: 200, body: { data: { pong: true, organizationId: "org-1", scopes: ["audits:read"] } } };
    }),
  });

  const result = await client.ping();
  assert.equal(capturedUrl, "https://app.public-map.com/api/v1/ping");
  assert.equal(capturedAuth, "Bearer pm_live_test");
  assert.deepEqual(result, { pong: true, organizationId: "org-1", scopes: ["audits:read"] });
});

test("audits.list: serializes query params and returns {data, pagination}", async () => {
  let capturedUrl = "";
  const client = new PublicMapClient({
    apiKey: "pm_live_test",
    fetch: fakeFetch((url) => {
      capturedUrl = url;
      return { status: 200, body: { data: [{ id: "a1", score: 90, summary: null, createdAt: "2026-01-01T00:00:00Z", location: null }], pagination: { limit: 5, nextCursor: null } } };
    }),
  });

  const page = await client.audits.list({ limit: 5, q: "café" });
  assert.match(capturedUrl, /\/audits\?/);
  assert.match(capturedUrl, /limit=5/);
  assert.match(capturedUrl, /q=caf%C3%A9/);
  assert.equal(page.data.length, 1);
  assert.equal(page.pagination.limit, 5);
});

test("tasks.create: sends Idempotency-Key header when provided", async () => {
  let capturedHeaders: Record<string, string> = {};
  const client = new PublicMapClient({
    apiKey: "pm_live_test",
    fetch: fakeFetch((url, init) => {
      capturedHeaders = init.headers as Record<string, string>;
      return { status: 201, body: { data: { id: "t1", clientId: "c1", title: "x", description: null, dueDate: null, status: "todo", createdAt: "2026-01-01T00:00:00Z" } } };
    }),
  });

  await client.tasks.create({ clientId: "c1", title: "Call back" }, { idempotencyKey: "retry-key-1" });
  assert.equal(capturedHeaders["Idempotency-Key"], "retry-key-1");
  assert.equal(capturedHeaders["Content-Type"], "application/json");
});

test("clients.update: PATCH with the correct method and body", async () => {
  let capturedMethod = "";
  let capturedBody = "";
  const client = new PublicMapClient({
    apiKey: "pm_live_test",
    fetch: fakeFetch((url, init) => {
      capturedMethod = init.method as string;
      capturedBody = init.body as string;
      return {
        status: 200,
        body: { data: { id: "c1", name: "New Name", contactName: null, email: null, phone: null, address: null, stage: "client", createdAt: "2026-01-01T00:00:00Z" } },
      };
    }),
  });

  const updated = await client.clients.update("c1", { name: "New Name" });
  assert.equal(capturedMethod, "PATCH");
  assert.deepEqual(JSON.parse(capturedBody), { name: "New Name" });
  assert.equal(updated.name, "New Name");
});

test("a non-2xx response throws PublicMapApiError with code/status/requestId/retryAfterSeconds", async () => {
  const client = new PublicMapClient({
    apiKey: "pm_live_test",
    fetch: fakeFetch(() => ({
      status: 429,
      body: { error: { code: "RATE_LIMITED", message: "Too many requests.", requestId: "req-123" } },
      headers: { "Retry-After": "42" },
    })),
  });

  await assert.rejects(
    () => client.ping(),
    (err: unknown) => {
      assert.ok(err instanceof PublicMapApiError);
      assert.equal(err.code, "RATE_LIMITED");
      assert.equal(err.status, 429);
      assert.equal(err.requestId, "req-123");
      assert.equal(err.retryAfterSeconds, 42);
      return true;
    },
  );
});

test("baseUrl override and trailing-slash normalization", async () => {
  let capturedUrl = "";
  const client = new PublicMapClient({
    apiKey: "k",
    baseUrl: "http://localhost:3000/api/v1/",
    fetch: fakeFetch((url) => {
      capturedUrl = url;
      return { status: 200, body: { data: { pong: true, organizationId: "o", scopes: [] } } };
    }),
  });
  await client.ping();
  assert.equal(capturedUrl, "http://localhost:3000/api/v1/ping");
});
