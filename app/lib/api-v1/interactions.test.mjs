import { mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { defaultExport: {} });
process.env.DATABASE_URL ??= "postgresql://unit-test-unused/db";

const { ApiError } = await import("@/lib/api-v1/errors");
const { validateInteractionCreateBody } = await import("@/lib/api-v1/interactions");
const { toInteractionDTO } = await import("@/lib/api-v1/dto");

const VALID = { clientId: "11111111-1111-1111-1111-111111111111", type: "call", summary: "Discussed renewal" };

test("validateInteractionCreateBody: rejects a non-object, empty, or array body", () => {
  for (const bad of [null, undefined, "x", 42, [], {}]) {
    assert.throws(() => validateInteractionCreateBody(bad), ApiError, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("validateInteractionCreateBody: rejects createdBy and every other forbidden/unknown field", () => {
  for (const body of [
    { ...VALID, createdBy: "hacker" },
    { ...VALID, id: "22222222-2222-2222-2222-222222222222" },
    { ...VALID, createdAt: "2026-01-01T00:00:00Z" },
    { ...VALID, organizationId: "33333333-3333-3333-3333-333333333333" },
    { ...VALID, notARealField: "x" },
  ]) {
    assert.throws(() => validateInteractionCreateBody(body), (error) => {
      assert.ok(error instanceof ApiError);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    });
  }
});

test("validateInteractionCreateBody: requires clientId, type, and summary", () => {
  assert.throws(() => validateInteractionCreateBody({ type: "call", summary: "x" }), ApiError);
  assert.throws(() => validateInteractionCreateBody({ clientId: VALID.clientId, summary: "x" }), ApiError);
  assert.throws(() => validateInteractionCreateBody({ clientId: VALID.clientId, type: "call" }), ApiError);
  assert.throws(() => validateInteractionCreateBody({ ...VALID, summary: "   " }), ApiError);
});

test("validateInteractionCreateBody: rejects an invalid type", () => {
  assert.throws(() => validateInteractionCreateBody({ ...VALID, type: "carrier-pigeon" }), ApiError);
});

test("validateInteractionCreateBody: accepts the minimal valid body, occurredAt is undefined (use DB default)", () => {
  const result = validateInteractionCreateBody(VALID);
  assert.equal(result.clientId, VALID.clientId);
  assert.equal(result.type, "call");
  assert.equal(result.summary, "Discussed renewal");
  assert.equal(result.occurredAt, undefined);
});

test("validateInteractionCreateBody: accepts an explicit occurredAt", () => {
  const result = validateInteractionCreateBody({ ...VALID, occurredAt: "2026-01-15T09:00:00Z" });
  assert.equal(result.occurredAt.toISOString(), "2026-01-15T09:00:00.000Z");
});

test("validateInteractionCreateBody: rejects an explicit null occurredAt (must be omitted, not nulled)", () => {
  assert.throws(() => validateInteractionCreateBody({ ...VALID, occurredAt: null }), ApiError);
});

test("validateInteractionCreateBody: rejects a malformed occurredAt", () => {
  assert.throws(() => validateInteractionCreateBody({ ...VALID, occurredAt: "not-a-date" }), ApiError);
});

test("toInteractionDTO: never exposes createdBy, even if present on the row", () => {
  const dto = toInteractionDTO({
    id: "1", clientId: VALID.clientId, type: "call", summary: "x",
    occurredAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z"),
    createdBy: "api:pm_live_secretlookingprefix — must never leak",
  });
  assert.deepEqual(Object.keys(dto).sort(), ["clientId", "createdAt", "dealId", "id", "occurredAt", "summary", "type"]);
  assert.strictEqual(dto.dealId, null, "a row without dealId is exposed as dealId: null (4F.8.5)");
});

// ---------- 4F.8.5 — optional dealId ----------

const DEAL_ID = "44444444-4444-4444-8444-444444444444";
function assertDealIdRejected(body) {
  assert.throws(() => validateInteractionCreateBody(body), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "VALIDATION_ERROR");
    assert.equal(error.message, '"dealId" must be a valid UUID or null.');
    return true;
  });
}

test("4F.8.5 validateInteractionCreateBody: dealId absent -> accepted, dealId null", () => {
  assert.strictEqual(validateInteractionCreateBody(VALID).dealId, null);
});

test("4F.8.5 validateInteractionCreateBody: dealId null -> accepted, dealId null", () => {
  assert.strictEqual(validateInteractionCreateBody({ ...VALID, dealId: null }).dealId, null);
});

test("4F.8.5 validateInteractionCreateBody: a valid UUID dealId -> accepted verbatim (ownership is checked later, in the route)", () => {
  assert.equal(validateInteractionCreateBody({ ...VALID, dealId: DEAL_ID }).dealId, DEAL_ID);
});

test("4F.8.5 validateInteractionCreateBody: a numeric dealId -> VALIDATION_ERROR", () => {
  assertDealIdRejected({ ...VALID, dealId: 42 });
});

test("4F.8.5 validateInteractionCreateBody: an empty-string dealId -> VALIDATION_ERROR", () => {
  assertDealIdRejected({ ...VALID, dealId: "" });
});

test("4F.8.5 validateInteractionCreateBody: a malformed UUID dealId -> VALIDATION_ERROR (also object/array/boolean)", () => {
  for (const dealId of ["not-a-uuid", "44444444-4444-4444-8444-44444444444", ` ${DEAL_ID}`, {}, [], true]) assertDealIdRejected({ ...VALID, dealId });
});

test("4F.8.5 validateInteractionCreateBody: the whitelist stays strict — an unknown field is still rejected, with or without dealId", () => {
  for (const body of [{ ...VALID, dealId: DEAL_ID, dealTitle: "x" }, { ...VALID, deal_id: DEAL_ID }, { ...VALID, notARealField: "x" }]) {
    assert.throws(() => validateInteractionCreateBody(body), (error) => error instanceof ApiError && error.code === "VALIDATION_ERROR" && /not allowed/.test(error.message));
  }
});

test("4F.8.5 toInteractionDTO: exposes dealId (UUID or null) and nothing else about the deal", () => {
  const row = { id: "1", clientId: VALID.clientId, type: "call", summary: "x", occurredAt: new Date("2026-01-01T00:00:00Z"), createdAt: new Date("2026-01-01T00:00:00Z") };
  assert.equal(toInteractionDTO({ ...row, dealId: DEAL_ID }).dealId, DEAL_ID);
  assert.strictEqual(toInteractionDTO({ ...row, dealId: null }).dealId, null);
});
