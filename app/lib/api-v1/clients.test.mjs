import { mock, test } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { defaultExport: {} });
process.env.DATABASE_URL ??= "postgresql://unit-test-unused/db";

const { ApiError } = await import("@/lib/api-v1/errors");
const { CLIENT_PATCHABLE_FIELDS, parseClientFilters, validateClientPatchBody } = await import("@/lib/api-v1/clients");
const { toClientDTO } = await import("@/lib/api-v1/dto");

test("CLIENT_PATCHABLE_FIELDS is exactly the tenant's own business-profile fields — no identifiers, no PUBLIC-MAP-internal fields", () => {
  assert.deepEqual([...CLIENT_PATCHABLE_FIELDS].sort(), ["address", "contactName", "email", "name", "phone"]);
});

test("validateClientPatchBody: rejects a non-object body (array, null, string, number)", () => {
  for (const bad of [[], null, "x", 42, undefined]) {
    assert.throws(() => validateClientPatchBody(bad), ApiError, `${JSON.stringify(bad)} should be rejected`);
  }
});

test("validateClientPatchBody: rejects an empty object — no silent no-op updates", () => {
  assert.throws(() => validateClientPatchBody({}), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return true;
  });
});

test("validateClientPatchBody: rejects ANY forbidden/unknown field, including identifiers, ownership, and PUBLIC-MAP-internal fields — the whole request fails, nothing is silently dropped", () => {
  const forbidden = [
    { id: "11111111-1111-1111-1111-111111111111" },
    { organizationId: "11111111-1111-1111-1111-111111111111" },
    { createdAt: "2026-01-01T00:00:00Z" },
    { archivedAt: "2026-01-01T00:00:00Z" },
    { stage: "client" },
    { source: "site web" },
    { ownerName: "Someone at the agency" },
    { notes: "internal notes" },
    { name: "OK Name", stage: "churned" }, // one allowed + one forbidden -> still rejected wholesale
    { totallyMadeUp: "x" },
  ];
  for (const body of forbidden) {
    assert.throws(() => validateClientPatchBody(body), (error) => {
      assert.ok(error instanceof ApiError, `${JSON.stringify(body)} should raise ApiError`);
      assert.equal(error.code, "VALIDATION_ERROR");
      return true;
    });
  }
});

test("validateClientPatchBody: accepts each patchable field individually", () => {
  assert.deepEqual(validateClientPatchBody({ name: "Café Central" }), { name: "Café Central" });
  assert.deepEqual(validateClientPatchBody({ contactName: "Jordan" }), { contactName: "Jordan" });
  assert.deepEqual(validateClientPatchBody({ email: "jordan@example.com" }), { email: "jordan@example.com" });
  assert.deepEqual(validateClientPatchBody({ phone: "+230 5xxx xxxx" }), { phone: "+230 5xxx xxxx" });
  assert.deepEqual(validateClientPatchBody({ address: "12 Rue de la Paix" }), { address: "12 Rue de la Paix" });
});

test("validateClientPatchBody: trims strings, and an empty/whitespace-only nullable field normalizes to null", () => {
  assert.deepEqual(validateClientPatchBody({ contactName: "  Jordan  " }), { contactName: "Jordan" });
  assert.deepEqual(validateClientPatchBody({ phone: "   " }), { phone: null });
});

test("validateClientPatchBody: nullable fields accept an explicit null (clearing the field)", () => {
  assert.deepEqual(validateClientPatchBody({ contactName: null }), { contactName: null });
  assert.deepEqual(validateClientPatchBody({ email: null, phone: null, address: null }), { email: null, phone: null, address: null });
});

test("validateClientPatchBody: rejects a blank or null \"name\" — it's NOT NULL in the schema", () => {
  assert.throws(() => validateClientPatchBody({ name: "" }), ApiError);
  assert.throws(() => validateClientPatchBody({ name: "   " }), ApiError);
  assert.throws(() => validateClientPatchBody({ name: null }), ApiError);
});

test("validateClientPatchBody: rejects non-string values for every field (numbers, booleans, objects, arrays)", () => {
  for (const field of CLIENT_PATCHABLE_FIELDS) {
    for (const badValue of [42, true, {}, []]) {
      assert.throws(() => validateClientPatchBody({ [field]: badValue }), ApiError, `${field}=${JSON.stringify(badValue)} should be rejected`);
    }
  }
});

test("validateClientPatchBody: rejects an email with no \"@\"", () => {
  assert.throws(() => validateClientPatchBody({ email: "not-an-email" }), (error) => {
    assert.ok(error instanceof ApiError);
    assert.equal(error.code, "VALIDATION_ERROR");
    return true;
  });
});

test("validateClientPatchBody: multiple valid fields at once", () => {
  const result = validateClientPatchBody({ name: "New Name", email: "new@example.com", phone: null });
  assert.deepEqual(result, { name: "New Name", email: "new@example.com", phone: null });
});

test("parseClientFilters: accepts a known stage, rejects an unknown one", () => {
  assert.deepEqual(parseClientFilters(new URLSearchParams("stage=client")), { stage: "client" });
  assert.throws(() => parseClientFilters(new URLSearchParams("stage=not-a-real-stage")), ApiError);
});

test("parseClientFilters: q is trimmed and length-capped", () => {
  assert.deepEqual(parseClientFilters(new URLSearchParams("q=  Café  ")), { q: "Café" });
});

test("toClientDTO: exposes only the intended fields — no ownerName/source/notes/archivedAt/organizationId", () => {
  const dto = toClientDTO({
    id: "1", name: "Café Central", contactName: "Jordan", email: "j@example.com", phone: "+230...", address: "12 Rue",
    stage: "client", createdAt: new Date("2026-01-01T00:00:00Z"),
  });
  assert.deepEqual(Object.keys(dto).sort(), ["address", "contactName", "createdAt", "email", "id", "name", "phone", "stage"]);
});
