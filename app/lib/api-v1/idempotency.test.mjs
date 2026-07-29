import { mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { defaultExport: {} });
process.env.DATABASE_URL ??= "postgresql://unit-test-unused/db";

const { ApiError } = await import("@/lib/api-v1/errors");
const { extractIdempotencyKey, hashRequestBody } = await import("@/lib/api-v1/idempotency");

test("extractIdempotencyKey: returns null when the header is absent (idempotency is opt-in)", () => {
  assert.equal(extractIdempotencyKey(new Request("https://example.com/")), null);
});

test("extractIdempotencyKey: returns null for an empty/whitespace-only header rather than an empty string", () => {
  assert.equal(extractIdempotencyKey(new Request("https://example.com/", { headers: { "idempotency-key": "   " } })), null);
});

test("extractIdempotencyKey: returns the trimmed key when present", () => {
  assert.equal(extractIdempotencyKey(new Request("https://example.com/", { headers: { "Idempotency-Key": "  order-42  " } })), "order-42");
});

test("extractIdempotencyKey: rejects an oversized key", () => {
  const huge = "x".repeat(500);
  assert.throws(() => extractIdempotencyKey(new Request("https://example.com/", { headers: { "idempotency-key": huge } })), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return true;
  });
});

test("hashRequestBody: identical bodies hash identically, different bodies hash differently", () => {
  const a = hashRequestBody({ title: "Follow up", clientId: "1" });
  const b = hashRequestBody({ title: "Follow up", clientId: "1" });
  const c = hashRequestBody({ title: "Different", clientId: "1" });
  assert.equal(a, b);
  assert.notEqual(a, c);
});

test("hashRequestBody: is independent of JSON key order — a realistic retry with re-serialized keys must not look like different content", () => {
  const a = hashRequestBody({ clientId: "1", title: "x", description: null });
  const b = hashRequestBody({ description: null, title: "x", clientId: "1" });
  assert.equal(a, b);
});

test("hashRequestBody: nested objects are also canonicalized, but array order is preserved (it's meaningful)", () => {
  const a = hashRequestBody({ outer: { b: 2, a: 1 }, list: [1, 2, 3] });
  const b = hashRequestBody({ list: [1, 2, 3], outer: { a: 1, b: 2 } });
  const differentOrderList = hashRequestBody({ outer: { a: 1, b: 2 }, list: [3, 2, 1] });
  assert.equal(a, b);
  assert.notEqual(a, differentOrderList);
});

test("hashRequestBody: treats null/undefined body consistently (never throws)", () => {
  assert.equal(hashRequestBody(null), hashRequestBody(undefined));
});
