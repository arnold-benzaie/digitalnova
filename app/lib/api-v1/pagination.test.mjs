import { mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { defaultExport: {} });
process.env.DATABASE_URL ??= "postgresql://unit-test-unused/db";

const { ApiError } = await import("@/lib/api-v1/errors");
const { buildPageMeta, decodeCursor, encodeCursor, parsePaginationParams } = await import("@/lib/api-v1/pagination");

test("encodeCursor/decodeCursor: round-trips exactly", () => {
  const cursor = { createdAt: "2026-01-15T10:00:00.000Z", id: "11111111-1111-1111-1111-111111111111" };
  assert.deepEqual(decodeCursor(encodeCursor(cursor)), cursor);
});

test("decodeCursor: rejects a non-base64url / non-JSON cursor", () => {
  assert.throws(() => decodeCursor("not-a-real-cursor!!!"), ApiError);
});

test("decodeCursor: rejects valid base64/JSON with the wrong shape", () => {
  const badShape = Buffer.from(JSON.stringify({ createdAt: "2026-01-15T10:00:00.000Z" }), "utf8").toString("base64url"); // missing id
  assert.throws(() => decodeCursor(badShape), ApiError);
});

test("decodeCursor: rejects a syntactically-shaped but non-date createdAt", () => {
  const badDate = Buffer.from(JSON.stringify({ createdAt: "not-a-date", id: "x" }), "utf8").toString("base64url");
  assert.throws(() => decodeCursor(badDate), ApiError);
});

test("parsePaginationParams: defaults to limit=20, no cursor", () => {
  const result = parsePaginationParams(new URLSearchParams());
  assert.equal(result.limit, 20);
  assert.equal(result.cursor, null);
});

test("parsePaginationParams: accepts a valid limit", () => {
  assert.equal(parsePaginationParams(new URLSearchParams("limit=5")).limit, 5);
  assert.equal(parsePaginationParams(new URLSearchParams("limit=100")).limit, 100);
});

test("parsePaginationParams: rejects limit=0, negative, non-integer, and above the max", () => {
  for (const bad of ["0", "-1", "3.5", "101", "abc", ""]) {
    assert.throws(() => parsePaginationParams(new URLSearchParams(`limit=${bad}`)), ApiError, `limit=${bad} should be rejected`);
  }
});

test("parsePaginationParams: propagates an invalid cursor as a VALIDATION_ERROR", () => {
  assert.throws(() => parsePaginationParams(new URLSearchParams("cursor=garbage")), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.status, 400);
    return true;
  });
});

test("buildPageMeta: no extra row -> full page, nextCursor is null", () => {
  const rows = [
    { id: "a", createdAt: new Date("2026-01-03T00:00:00Z") },
    { id: "b", createdAt: new Date("2026-01-02T00:00:00Z") },
  ];
  const { page, nextCursor } = buildPageMeta(rows, 5);
  assert.equal(page.length, 2);
  assert.equal(nextCursor, null);
});

test("buildPageMeta: an extra row -> trims to limit, encodes nextCursor from the LAST returned row (not the discarded extra one)", () => {
  const rows = [
    { id: "a", createdAt: new Date("2026-01-05T00:00:00Z") },
    { id: "b", createdAt: new Date("2026-01-04T00:00:00Z") },
    { id: "c", createdAt: new Date("2026-01-03T00:00:00Z") }, // the +1 lookahead row, must be discarded
  ];
  const { page, nextCursor } = buildPageMeta(rows, 2);
  assert.deepEqual(page.map((r) => r.id), ["a", "b"]);
  assert.ok(nextCursor);
  assert.deepEqual(decodeCursor(nextCursor), { createdAt: "2026-01-04T00:00:00.000Z", id: "b" });
});
