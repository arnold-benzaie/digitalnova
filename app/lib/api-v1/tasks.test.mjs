import { mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { defaultExport: {} });
process.env.DATABASE_URL ??= "postgresql://unit-test-unused/db";

const { ApiError } = await import("@/lib/api-v1/errors");
const { validateTaskCreateBody } = await import("@/lib/api-v1/tasks");
const { toTaskDTO } = await import("@/lib/api-v1/dto");

const VALID = { clientId: "11111111-1111-1111-1111-111111111111", title: "Follow up" };

test("validateTaskCreateBody: rejects a non-object, empty, or array body", () => {
  for (const bad of [null, undefined, "x", 42, [], {}]) {
    assert.throws(() => validateTaskCreateBody(bad), ApiError, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("validateTaskCreateBody: rejects any field outside the whitelist, including assignee, clientId's owner fields, or system fields", () => {
  for (const body of [
    { ...VALID, assignee: "Someone" },
    { ...VALID, id: "22222222-2222-2222-2222-222222222222" },
    { ...VALID, createdAt: "2026-01-01T00:00:00Z" },
    { ...VALID, organizationId: "33333333-3333-3333-3333-333333333333" },
    { ...VALID, createdBy: "hacker" },
    { ...VALID, totallyMadeUp: "x" },
  ]) {
    assert.throws(() => validateTaskCreateBody(body), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    });
  }
});

test("validateTaskCreateBody: requires clientId and title", () => {
  assert.throws(() => validateTaskCreateBody({ title: "x" }), ApiError); // missing clientId
  assert.throws(() => validateTaskCreateBody({ clientId: VALID.clientId }), ApiError); // missing title
  assert.throws(() => validateTaskCreateBody({ ...VALID, title: "   " }), ApiError); // blank title
});

test("validateTaskCreateBody: accepts the minimal valid body, defaults status to todo", () => {
  const result = validateTaskCreateBody(VALID);
  assert.equal(result.clientId, VALID.clientId);
  assert.equal(result.title, "Follow up");
  assert.equal(result.status, "todo");
  assert.equal(result.description, null);
  assert.equal(result.dueDate, null);
});

test("validateTaskCreateBody: accepts every optional field", () => {
  const result = validateTaskCreateBody({ ...VALID, description: "Call back next week", dueDate: "2026-02-01T10:00:00Z", status: "in_progress" });
  assert.equal(result.description, "Call back next week");
  assert.equal(result.dueDate.toISOString(), "2026-02-01T10:00:00.000Z");
  assert.equal(result.status, "in_progress");
});

test("validateTaskCreateBody: rejects an invalid status value", () => {
  assert.throws(() => validateTaskCreateBody({ ...VALID, status: "cancelled" }), ApiError);
});

test("validateTaskCreateBody: rejects a malformed dueDate", () => {
  assert.throws(() => validateTaskCreateBody({ ...VALID, dueDate: "not-a-date" }), ApiError);
});

test("toTaskDTO: never exposes assignee, even if present on the row", () => {
  const dto = toTaskDTO({
    id: "1", clientId: VALID.clientId, title: "x", description: null, dueDate: null, status: "todo",
    createdAt: new Date("2026-01-01T00:00:00Z"), assignee: "Internal Staffer — must never leak",
  });
  assert.deepEqual(Object.keys(dto).sort(), ["clientId", "createdAt", "description", "dueDate", "id", "status", "title"]);
});
