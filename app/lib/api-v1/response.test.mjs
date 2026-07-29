import { mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { defaultExport: {} });
process.env.DATABASE_URL ??= "postgresql://unit-test-unused/db";

const { ApiAuthError } = await import("@/lib/api-v1/auth");
const { apiError, apiSuccess, handleApiError } = await import("@/lib/api-v1/response");

test("apiSuccess: wraps the payload in {data}, defaults to 200, sets X-Request-Id", async () => {
  const response = apiSuccess({ pong: true }, "req-1");
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("X-Request-Id"), "req-1");
  assert.deepEqual(await response.json(), { data: { pong: true } });
});

test("apiSuccess: accepts a custom status and extra top-level meta (e.g. pagination)", async () => {
  const response = apiSuccess([{ id: 1 }], "req-2", { status: 201, meta: { pagination: { page: 1, pageSize: 20, total: 1, totalPages: 1 } } });
  assert.equal(response.status, 201);
  const body = await response.json();
  assert.deepEqual(body.data, [{ id: 1 }]);
  assert.deepEqual(body.pagination, { page: 1, pageSize: 20, total: 1, totalPages: 1 });
});

test("apiError: produces {error:{code,message,requestId}} with the matching HTTP status", async () => {
  const response = apiError("FORBIDDEN_SCOPE", "missing scope", 403, "req-3");
  assert.equal(response.status, 403);
  assert.equal(response.headers.get("X-Request-Id"), "req-3");
  assert.deepEqual(await response.json(), { error: { code: "FORBIDDEN_SCOPE", message: "missing scope", requestId: "req-3" } });
});

test("handleApiError: an ApiAuthError is translated using its own code/status/message", async () => {
  const error = new ApiAuthError("API_KEY_REVOKED", "This API key has been revoked.");
  const response = handleApiError(error, "req-4");
  assert.equal(response.status, 401);
  const body = await response.json();
  assert.equal(body.error.code, "API_KEY_REVOKED");
  assert.equal(body.error.message, "This API key has been revoked.");
  assert.equal(body.error.requestId, "req-4");
});

test("handleApiError: an unexpected error never leaks internal detail, always maps to 500 INTERNAL_ERROR", async () => {
  const response = handleApiError(new Error("leaked db connection string: postgres://..."), "req-5");
  assert.equal(response.status, 500);
  const body = await response.json();
  assert.equal(body.error.code, "INTERNAL_ERROR");
  assert.equal(body.error.message.includes("postgres://"), false);
  assert.equal(body.error.requestId, "req-5");
});
