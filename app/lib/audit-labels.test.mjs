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
