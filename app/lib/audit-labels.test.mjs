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

/* ------------------------------------------------------------------ *
 * RADAR INTELLIGENCE V2.1 — Phase B — radar_ai.policy_updated label
 * ------------------------------------------------------------------ */

test("radar_ai.policy_updated — real FR/EN labels (never the raw action string)", () => {
  const entryFor = (metadata = {}) => ({ action: "radar_ai.policy_updated", targetType: "radar_ai_provider_policy", targetId: "global", metadata });
  assert.equal(describeAuditEntry(entryFor(), "fr"), "Politique de fournisseur IA RADAR mise à jour");
  assert.equal(describeAuditEntry(entryFor(), "en"), "RADAR AI provider policy updated");
});

test("category: radar_ai.policy_updated -> 'radar_ai' -> localized category labels", () => {
  assert.equal(categoryOf("radar_ai.policy_updated"), "radar_ai");
  assert.equal(getAuditCategoryLabel("fr").radar_ai, "IA RADAR (politique fournisseur)");
  assert.equal(getAuditCategoryLabel("en").radar_ai, "RADAR AI (provider policy)");
});

/* ------------------------------------------------------------------ *
 * RADAR INTELLIGENCE V2.1 — Phase C — radar_ai.policy_reset label
 * ------------------------------------------------------------------ */

test("radar_ai.policy_reset — real FR/EN labels (never the raw action string), same category as policy_updated", () => {
  const entryFor = (metadata = {}) => ({ action: "radar_ai.policy_reset", targetType: "radar_ai_provider_policy", targetId: "global", metadata });
  assert.equal(describeAuditEntry(entryFor(), "fr"), "Politique de fournisseur IA RADAR réinitialisée (valeurs par défaut)");
  assert.equal(describeAuditEntry(entryFor(), "en"), "RADAR AI provider policy reset to default");
  assert.equal(categoryOf("radar_ai.policy_reset"), "radar_ai");
});

/* ------------------------------------------------------------------ *
 * RADAR INTELLIGENCE V2.1 — Phase E — radar_ai.model_changed label
 * ------------------------------------------------------------------ */

test("radar_ai.model_changed — real FR/EN labels including provider + new model, never the raw action string", () => {
  const entryFor = (metadata) => ({ action: "radar_ai.model_changed", targetType: "radar_ai_provider_runtime_config", targetId: "anthropic", metadata });
  const metadata = { providerId: "anthropic", beforeModel: "claude-sonnet-4-5", afterModel: "claude-sonnet-5" };
  const fr = describeAuditEntry(entryFor(metadata), "fr");
  const en = describeAuditEntry(entryFor(metadata), "en");
  assert.notEqual(fr, "radar_ai.model_changed");
  assert.notEqual(en, "radar_ai.model_changed");
  assert.match(fr, /anthropic/);
  assert.match(fr, /claude-sonnet-5/);
  assert.match(en, /anthropic/);
  assert.match(en, /claude-sonnet-5/);
});

test("radar_ai.model_changed — missing providerId/afterModel metadata still degrades to a safe generic label, never a raw action string or a crash", () => {
  const entryFor = { action: "radar_ai.model_changed", targetType: "radar_ai_provider_runtime_config", targetId: "anthropic", metadata: {} };
  assert.doesNotThrow(() => describeAuditEntry(entryFor, "fr"));
  assert.doesNotThrow(() => describeAuditEntry(entryFor, "en"));
  assert.notEqual(describeAuditEntry(entryFor, "fr"), "radar_ai.model_changed");
  assert.notEqual(describeAuditEntry(entryFor, "en"), "radar_ai.model_changed");
});

test("radar_ai.model_changed — never renders the old model / any secret-shaped metadata, even if maliciously injected", () => {
  const entryFor = {
    action: "radar_ai.model_changed",
    targetType: "radar_ai_provider_runtime_config",
    targetId: "anthropic",
    metadata: { providerId: "anthropic", afterModel: "claude-sonnet-5", apiKey: "sk-ant-LEAK", authorization: "Bearer sk-ant-LEAK" },
  };
  const fr = describeAuditEntry(entryFor, "fr");
  const en = describeAuditEntry(entryFor, "en");
  assert.ok(!fr.includes("sk-ant-LEAK"));
  assert.ok(!en.includes("sk-ant-LEAK"));
});

test("category: radar_ai.model_changed -> 'radar_ai' -> same localized category as policy_updated/policy_reset", () => {
  assert.equal(categoryOf("radar_ai.model_changed"), "radar_ai");
  assert.equal(getAuditCategoryLabel("fr").radar_ai, "IA RADAR (politique fournisseur)");
  assert.equal(getAuditCategoryLabel("en").radar_ai, "RADAR AI (provider policy)");
});
