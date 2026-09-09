// Unit tests for Chantier 1 / Phase 5's audit-label additions
// (crm.quote_sent, crm.quote_accepted, crm.quote_declined) — describeAuditEntry
// is a pure function (no DB, no mocks needed).
//
// Run with: npx tsx --test lib/audit-labels.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { describeAuditEntry } from "./audit-labels.ts";

const NEW_QUOTE_ACTIONS = ["crm.quote_sent", "crm.quote_accepted", "crm.quote_declined"];

function entry(action) {
  return { action, targetType: "crm_quote", targetId: "irrelevant-id", metadata: { quoteNumber: "DEV-2026-0042" } };
}

test("FR — none of the three new quote actions falls back to the raw technical action string", () => {
  for (const action of NEW_QUOTE_ACTIONS) {
    const label = describeAuditEntry(entry(action), "fr");
    assert.notEqual(label, action, `${action} must not render as its own raw name`);
    assert.match(label, /DEV-2026-0042/, `${action}'s FR label must include the quote number`);
  }
});

test("EN — none of the three new quote actions falls back to the raw technical action string", () => {
  for (const action of NEW_QUOTE_ACTIONS) {
    const label = describeAuditEntry(entry(action), "en");
    assert.notEqual(label, action, `${action} must not render as its own raw name`);
    assert.match(label, /DEV-2026-0042/, `${action}'s EN label must include the quote number`);
  }
});

test("FR labels match the exact expected sentences", () => {
  assert.equal(describeAuditEntry(entry("crm.quote_sent"), "fr"), "Devis envoyé : DEV-2026-0042");
  assert.equal(describeAuditEntry(entry("crm.quote_accepted"), "fr"), "Devis accepté : DEV-2026-0042");
  assert.equal(describeAuditEntry(entry("crm.quote_declined"), "fr"), "Devis refusé : DEV-2026-0042");
});

test("EN labels match the exact expected sentences", () => {
  assert.equal(describeAuditEntry(entry("crm.quote_sent"), "en"), "Quote sent: DEV-2026-0042");
  assert.equal(describeAuditEntry(entry("crm.quote_accepted"), "en"), "Quote accepted: DEV-2026-0042");
  assert.equal(describeAuditEntry(entry("crm.quote_declined"), "en"), "Quote declined: DEV-2026-0042");
});

/* ------------------------------------------------------------------ *
 * PHASE OWNER-UI (Slice 3) — owner.admin_* governance labels + category
 * ------------------------------------------------------------------ */
import { getAuditCategoryLabel, categoryOf } from "./audit-labels.ts";

const OWNER_ADMIN_ACTIONS = ["owner.admin_demoted", "owner.admin_suspended", "owner.admin_reactivated", "owner.admin_offboarded"];
const ownerEntry = (action, metadata = {}) => ({ action, targetType: "staff_member", targetId: "irrelevant", metadata });

test("owner.admin_* — every action has a real FR label (never the raw action string)", () => {
  for (const action of OWNER_ADMIN_ACTIONS) {
    const label = describeAuditEntry(ownerEntry(action), "fr");
    assert.notEqual(label, action, `${action} FR label must not be its raw name`);
    assert.match(label, /^Administrateur /, `${action} FR label should start with "Administrateur "`);
  }
});

test("owner.admin_* — every action has a real EN label (never the raw action string)", () => {
  for (const action of OWNER_ADMIN_ACTIONS) {
    const label = describeAuditEntry(ownerEntry(action), "en");
    assert.notEqual(label, action, `${action} EN label must not be its raw name`);
    assert.match(label, /^Administrator /, `${action} EN label should start with "Administrator "`);
  }
});

test("owner.admin_demoted — FR wording follows metadata.newRole (Manager / Employé / neutral)", () => {
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_demoted", { newRole: "MANAGER" }), "fr"), "Administrateur rétrogradé vers Manager");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_demoted", { newRole: "EMPLOYEE" }), "fr"), "Administrateur rétrogradé vers Employé");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_demoted", {}), "fr"), "Administrateur rétrogradé");
});

test("owner.admin_demoted — EN wording follows metadata.newRole (Manager / Employee / neutral)", () => {
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_demoted", { newRole: "MANAGER" }), "en"), "Administrator demoted to Manager");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_demoted", { newRole: "EMPLOYEE" }), "en"), "Administrator demoted to Employee");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_demoted", {}), "en"), "Administrator demoted");
});

test("owner.admin_* — exact FR / EN sentences for the non-parameterized events", () => {
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_suspended"), "fr"), "Administrateur suspendu");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_reactivated"), "fr"), "Administrateur réactivé");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_offboarded"), "fr"), "Administrateur retiré de l’administration");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_suspended"), "en"), "Administrator suspended");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_reactivated"), "en"), "Administrator reactivated");
  assert.equal(describeAuditEntry(ownerEntry("owner.admin_offboarded"), "en"), "Administrator removed from administration");
});

test("category: owner.admin_* -> 'owner' -> localized 'Propriétaire' / 'Owner governance'", () => {
  assert.equal(categoryOf("owner.admin_suspended"), "owner");
  assert.equal(getAuditCategoryLabel("fr").owner, "Propriétaire");
  assert.equal(getAuditCategoryLabel("en").owner, "Owner governance");
});

test("unknown action still falls back to the raw action string (existing behavior preserved)", () => {
  assert.equal(describeAuditEntry(ownerEntry("owner.something_new"), "fr"), "owner.something_new");
  assert.equal(describeAuditEntry(ownerEntry("totally.unknown"), "en"), "totally.unknown");
});
