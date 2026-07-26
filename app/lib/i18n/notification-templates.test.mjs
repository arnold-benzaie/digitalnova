// Bilingual notification rendering — run with:
//   npx tsx --test lib/i18n/notification-templates.test.mjs
// Covers renderNotification()/renderNotificationFr()/resolveTemplate()'s
// pure logic: same DB row renders differently per locale, legacy rows
// (no metadata, or an unrecognized type) fall back to stored text
// unchanged, and user/AI-authored body content is never re-translated.
import { test } from "node:test";
import assert from "node:assert/strict";
import { renderNotification, renderNotificationFr } from "./notification-templates.ts";

test("renderNotification: same row renders different text per locale", () => {
  const item = {
    type: "user.approved",
    title: "Utilisateur approuvé",
    body: "Jane Doe a été approuvé(e) en tant que client — Acme.",
    metadata: { name: "Jane Doe", role: "client", organizationName: "Acme" },
  };
  const fr = renderNotification(item, "fr");
  const en = renderNotification(item, "en");
  assert.equal(fr.title, "Utilisateur approuvé");
  assert.equal(en.title, "User approved");
  assert.match(fr.body, /Jane Doe/);
  assert.match(en.body, /Jane Doe/);
  assert.notEqual(fr.body, en.body);
});

test("renderNotification: never mangles a business name/entity passed through metadata", () => {
  const item = {
    type: "user.organization_changed",
    title: "Organisation modifiée",
    body: "Un membre a été transféré vers Café Central.",
    metadata: { organizationName: "Café Central" },
  };
  const en = renderNotification(item, "en");
  assert.match(en.body, /Café Central/);
});

test("renderNotification: legacy row with no metadata falls back to the stored title/body untouched, even when requesting English", () => {
  const item = {
    type: "user.approved",
    title: "Utilisateur approuvé (ancienne notification)",
    body: "Texte historique jamais retraduit.",
    metadata: null,
  };
  const en = renderNotification(item, "en");
  assert.equal(en.title, "Utilisateur approuvé (ancienne notification)");
  assert.equal(en.body, "Texte historique jamais retraduit.");
});

test("renderNotification: unrecognized type falls back to stored text unchanged", () => {
  const item = {
    type: "some.unknown.type",
    title: "Titre original",
    body: "Corps original",
    metadata: { anything: true },
  };
  const en = renderNotification(item, "en");
  assert.equal(en.title, "Titre original");
  assert.equal(en.body, "Corps original");
});

test("renderNotification: fastspring.<dynamic> events resolve via the generic wildcard template", () => {
  const item = { type: "fastspring.order.completed", title: "x", body: null, metadata: {} };
  const fr = renderNotification(item, "fr");
  const en = renderNotification(item, "en");
  assert.equal(fr.title, "Mise à jour de facturation");
  assert.equal(en.title, "Billing update");
});

test("renderNotification: user/AI-authored body (audit summary, onboarding summary, chat message) is never re-templated — falls back to the verbatim stored text in every locale", () => {
  const aiSummary = "Résumé généré par l'IA à partir des réponses du client, contenu libre.";
  const item = {
    type: "audit.generated",
    title: "Audit terminé — score 82/100",
    body: aiSummary,
    metadata: { score: 82 },
  };
  const fr = renderNotification(item, "fr");
  const en = renderNotification(item, "en");
  assert.equal(fr.body, aiSummary);
  assert.equal(en.body, aiSummary, "body must stay verbatim — it's the AI's own prose, not translatable UI copy");
  assert.notEqual(fr.title, en.title, "the title chrome IS translated");
});

test("renderNotification: report.generated correctly translates the frequency enum instead of leaking the raw DB value into prose", () => {
  const item = { type: "report.generated", title: "x", body: null, metadata: { frequency: "monthly", score: 71 } };
  const fr = renderNotification(item, "fr");
  const en = renderNotification(item, "en");
  assert.equal(fr.title, "Rapport mensuel disponible");
  assert.equal(en.title, "monthly report available");
  assert.doesNotMatch(fr.title, /\bmonthly\b/);
});

test("renderNotificationFr: computes the canonical French text stored in the DB columns, matching what renderNotification('fr') would produce", () => {
  const rendered = renderNotificationFr("user.suspended", { name: "John Smith" });
  assert.equal(rendered.title, "Utilisateur suspendu");
  assert.match(rendered.body, /John Smith/);
});

test("renderNotificationFr: returns null for an unrecognized type (nothing to persist as canonical text)", () => {
  assert.equal(renderNotificationFr("totally.unknown", {}), null);
});

test("renderNotification: gbp.synced branches (success/metrics-unavailable/reviews-unavailable) all translate distinctly", () => {
  const base = { type: "gbp.synced", title: "x", body: null };
  const success = renderNotification({ ...base, metadata: { locationCount: 3 } }, "en");
  const metricsDown = renderNotification({ ...base, metadata: { locationCount: 3, metricsUnavailable: true, errorMessage: "quota" } }, "en");
  const reviewsDown = renderNotification({ ...base, metadata: { locationCount: 3, reviewsUnavailable: true } }, "en");
  assert.match(success.body, /3 location\(s\) updated\.$/);
  assert.match(metricsDown.body, /Google stats unavailable — quota/);
  assert.match(reviewsDown.body, /Google reviews unavailable/);
});
