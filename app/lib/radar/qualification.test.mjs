// Pure unit tests for lib/radar/qualification.ts's assessQualification().
// Zero I/O, zero database, zero network — plain function over fixture data.
// Run with: npx tsx --test lib/radar/qualification.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assessQualification } from "./qualification.ts";

function base(overrides = {}) {
  return {
    name: "Boulangerie Test",
    email: "contact@example.test",
    phone: null,
    doNotContact: false,
    archivedAt: null,
    ...overrides,
  };
}

// ---- valid name + email ----
test("valid name + email is QUALIFIED, contactable", () => {
  const result = assessQualification(base({ email: "contact@example.test", phone: null }));
  assert.deepEqual(result, { qualificationStatus: "QUALIFIED", eligibility: { contactable: true } });
});

// ---- valid name + phone ----
test("valid name + phone (no email) is QUALIFIED, contactable", () => {
  const result = assessQualification(base({ email: null, phone: "01 42 00 00 01" }));
  assert.deepEqual(result, { qualificationStatus: "QUALIFIED", eligibility: { contactable: true } });
});

// ---- name only, no contact method ----
test("name only, no email or phone, is INSUFFICIENT_DATA but still contactable (nothing blocks it)", () => {
  const result = assessQualification(base({ email: null, phone: null }));
  assert.deepEqual(result, { qualificationStatus: "INSUFFICIENT_DATA", eligibility: { contactable: true } });
});

// ---- contact only / missing meaningful name ----
test("email present but blank/missing name is INSUFFICIENT_DATA", () => {
  const result = assessQualification(base({ name: null, email: "contact@example.test" }));
  assert.equal(result.qualificationStatus, "INSUFFICIENT_DATA");
});

test("a whitespace-only name is treated as missing (not meaningful)", () => {
  const result = assessQualification(base({ name: "   " }));
  assert.equal(result.qualificationStatus, "INSUFFICIENT_DATA");
});

test("a whitespace-only email/phone is treated as missing (not a usable contact method)", () => {
  const result = assessQualification(base({ email: "   ", phone: "   " }));
  assert.equal(result.qualificationStatus, "INSUFFICIENT_DATA");
});

// ---- doNotContact=true ----
test("doNotContact=true is NOT_ELIGIBLE, not contactable, regardless of otherwise-complete data", () => {
  const result = assessQualification(base({ doNotContact: true }));
  assert.deepEqual(result, { qualificationStatus: "NOT_ELIGIBLE", eligibility: { contactable: false, reason: "do_not_contact" } });
});

test("doNotContact=true takes priority even over missing name/contact info (reported as NOT_ELIGIBLE, not INSUFFICIENT_DATA)", () => {
  const result = assessQualification(base({ doNotContact: true, name: null, email: null, phone: null }));
  assert.equal(result.qualificationStatus, "NOT_ELIGIBLE");
  assert.equal(result.eligibility.contactable, false);
});

// ---- archived prospect ----
test("archivedAt set is NOT_ELIGIBLE, not contactable, regardless of otherwise-complete data", () => {
  const result = assessQualification(base({ archivedAt: new Date("2026-01-01T00:00:00Z") }));
  assert.deepEqual(result, { qualificationStatus: "NOT_ELIGIBLE", eligibility: { contactable: false, reason: "archived" } });
});

// ---- both hard gates: doNotContact wins the reported reason first ----
test("both doNotContact and archivedAt set: still NOT_ELIGIBLE (doNotContact checked first)", () => {
  const result = assessQualification(base({ doNotContact: true, archivedAt: new Date("2026-01-01T00:00:00Z") }));
  assert.equal(result.qualificationStatus, "NOT_ELIGIBLE");
  assert.equal(result.eligibility.contactable, false);
  assert.equal(result.eligibility.reason, "do_not_contact");
});

// ---- fully qualified, everything present ----
test("fully populated valid prospect is QUALIFIED", () => {
  const result = assessQualification(base({ name: "Cabinet Dentaire Santé Sourire", email: "contact@santesourire.fr", phone: "05 61 00 00 03" }));
  assert.equal(result.qualificationStatus, "QUALIFIED");
  assert.equal(result.eligibility.contactable, true);
});
