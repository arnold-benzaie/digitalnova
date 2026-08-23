// Pure-function tests for internal product-activity tracking (2026-08
// Phase 1) — run with: npx tsx --test --experimental-test-module-mocks lib/product-events.test.mjs
// @/db is mocked (an empty stub) purely so the module can load without a
// real DATABASE_URL — none of the functions tested here touch it. Real
// scoping/writing behavior against Postgres is covered separately by
// lib/product-events.integration.test.mjs.
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";

// "server-only" always throws when required by plain Node (it has no
// build-tool-specific detection — see node_modules/server-only/index.js) —
// mocked out here purely so this file can be imported for its pure
// functions; every other "server-only" module in this codebase is, for
// the same reason, untested at the unit level and covered by integration/
// e2e tests instead.
mock.module("server-only", { namedExports: {} });
mock.module("@/db", { namedExports: { db: {} } });

const {
  PRODUCT_EVENT_TYPES,
  sanitizePath,
  sanitizeMetadata,
  retentionThreshold,
  describeProductEvent,
  productEventClientWhere,
} = await import("./product-events.ts");

// ---- eventType --------------------------------------------------------

test("PRODUCT_EVENT_TYPES is exactly the closed union agreed for Phase 1 (+ the AI Assistant widget's Phase 1A additions)", () => {
  assert.deepEqual(
    [...PRODUCT_EVENT_TYPES].sort(),
    [
      "download_document",
      "login",
      "open_audit",
      "open_report",
      "page_view",
      "chat_widget_viewed",
      "chat_opened",
      "chat_closed",
      "chat_message_sent",
      "suggested_question_clicked",
      "human_support_requested",
      "lead_form_opened",
      "lead_submitted",
      "chat_error",
    ].sort(),
  );
});

// ---- sanitizePath -------------------------------------------------------

test("sanitizePath: keeps a plain internal path unchanged", () => {
  assert.equal(sanitizePath("/dashboard/gbp"), "/dashboard/gbp");
});

test("sanitizePath: strips a query string", () => {
  assert.equal(sanitizePath("/dashboard/audits?ref=email&token=abc123"), "/dashboard/audits");
});

test("sanitizePath: strips a fragment", () => {
  assert.equal(sanitizePath("/dashboard/reports#section-2"), "/dashboard/reports");
});

test("sanitizePath: rejects anything not starting with /", () => {
  assert.equal(sanitizePath("https://evil.example.com/phish"), null);
  assert.equal(sanitizePath("javascript:alert(1)"), null);
});

test("sanitizePath: null/undefined/empty all become null", () => {
  assert.equal(sanitizePath(null), null);
  assert.equal(sanitizePath(undefined), null);
  assert.equal(sanitizePath(""), null);
});

test("sanitizePath: caps length rather than storing an unbounded string", () => {
  const huge = `/${"a".repeat(500)}`;
  const result = sanitizePath(huge);
  assert.ok(result.length <= 200);
});

// ---- sanitizeMetadata -----------------------------------------------------

test("sanitizeMetadata: passes through small string/number/boolean values", () => {
  assert.deepEqual(sanitizeMetadata({ source: "dashboard", count: 3, ok: true }), { source: "dashboard", count: 3, ok: true });
});

test("sanitizeMetadata: drops keys matching the forbidden pattern regardless of value", () => {
  const result = sanitizeMetadata({
    accessToken: "should-never-be-stored",
    refreshToken: "should-never-be-stored",
    password: "should-never-be-stored",
    authorization: "should-never-be-stored",
    cookie: "should-never-be-stored",
    fileName: "invoice.pdf",
  });
  assert.deepEqual(result, { fileName: "invoice.pdf" });
});

test("sanitizeMetadata: drops nested objects and arrays, keeps flat values", () => {
  const result = sanitizeMetadata({ fileName: "report.pdf", nested: { a: 1 }, list: [1, 2, 3] });
  assert.deepEqual(result, { fileName: "report.pdf" });
});

test("sanitizeMetadata: caps at 5 keys", () => {
  const result = sanitizeMetadata({ a: 1, b: 2, c: 3, d: 4, e: 5, f: 6 });
  assert.equal(Object.keys(result).length, 5);
});

test("sanitizeMetadata: truncates an overlong string value", () => {
  const result = sanitizeMetadata({ note: "x".repeat(500) });
  assert.ok(result.note.length <= 200);
});

test("sanitizeMetadata: null/undefined/empty-after-filtering all become null", () => {
  assert.equal(sanitizeMetadata(null), null);
  assert.equal(sanitizeMetadata(undefined), null);
  assert.equal(sanitizeMetadata({}), null);
  assert.equal(sanitizeMetadata({ token: "x" }), null);
});

// ---- retentionThreshold ----------------------------------------------------

test("retentionThreshold: 90 days before `now` by default", () => {
  const now = new Date("2026-08-10T12:00:00.000Z");
  const threshold = retentionThreshold(90, now);
  assert.equal(threshold.toISOString(), "2026-05-12T12:00:00.000Z");
});

test("retentionThreshold: a shorter window moves the threshold closer to now", () => {
  const now = new Date("2026-08-10T00:00:00.000Z");
  const threshold30 = retentionThreshold(30, now);
  const threshold90 = retentionThreshold(90, now);
  assert.ok(threshold30.getTime() > threshold90.getTime());
});

// ---- describeProductEvent --------------------------------------------------

test("describeProductEvent: login (fr/en)", () => {
  const row = { eventType: "login", path: null, entityType: null, entityId: null, metadata: null };
  assert.deepEqual(describeProductEvent(row, "fr"), { self: "Vous vous êtes connecté(e).", third: "S'est connecté(e)." });
  assert.deepEqual(describeProductEvent(row, "en"), { self: "You signed in.", third: "Signed in." });
});

test("describeProductEvent: open_audit / open_report never leak a raw id", () => {
  const audit = { eventType: "open_audit", path: null, entityType: "audit", entityId: "abc-123", metadata: null };
  const report = { eventType: "open_report", path: null, entityType: "audit", entityId: "abc-123", metadata: null };
  for (const text of [describeProductEvent(audit, "fr").self, describeProductEvent(report, "fr").self]) {
    assert.ok(!text.includes("abc-123"));
  }
});

test("describeProductEvent: download_document uses the sanitized fileName when present", () => {
  const withName = { eventType: "download_document", path: null, entityType: "document", entityId: "d1", metadata: { fileName: "facture-07.pdf" } };
  assert.equal(describeProductEvent(withName, "fr").self, "Vous avez téléchargé facture-07.pdf.");
  assert.equal(describeProductEvent(withName, "en").third, "Downloaded facture-07.pdf.");
});

test("describeProductEvent: download_document falls back to a generic phrase without a fileName", () => {
  const noName = { eventType: "download_document", path: null, entityType: "document", entityId: "d1", metadata: null };
  assert.equal(describeProductEvent(noName, "fr").self, "Vous avez téléchargé un document.");
});

test("describeProductEvent: page_view on a known route resolves to a friendly label", () => {
  const row = { eventType: "page_view", path: "/dashboard/analytics", entityType: null, entityId: null, metadata: null };
  assert.equal(describeProductEvent(row, "fr").self, "Vous avez consulté Google Analytics.");
  assert.equal(describeProductEvent(row, "en").self, "You viewed Google Analytics.");
});

test("describeProductEvent: page_view on an unrecognized/unlabeled route returns null (never shows a raw path)", () => {
  const row = { eventType: "page_view", path: "/dashboard/settings/some-obscure-panel", entityType: null, entityId: null, metadata: null };
  assert.equal(describeProductEvent(row, "fr"), null);
});

test("describeProductEvent: page_view with no path at all returns null", () => {
  const row = { eventType: "page_view", path: null, entityType: null, entityId: null, metadata: null };
  assert.equal(describeProductEvent(row, "fr"), null);
});

test("describeProductEvent: an unknown eventType returns null rather than throwing", () => {
  const row = { eventType: "something_invented", path: null, entityType: null, entityId: null, metadata: null };
  assert.equal(describeProductEvent(row, "fr"), null);
});

// ---- productEventClientWhere (SQL-shape, same pattern as
// lib/notification-visibility.test.mjs's notificationVisibilityWhere) ------

test("productEventClientWhere: filters by BOTH organizationId and userId — never one alone", () => {
  const dialect = new PgDialect();
  const { sql, params } = dialect.sqlToQuery(productEventClientWhere("org-A", "user-A"));
  assert.match(sql, /"product_events"\."organization_id" = /);
  assert.match(sql, /"product_events"\."user_id" = /);
  assert.deepEqual(params, ["org-A", "user-A"]);
});

test("productEventClientWhere: a different org/user pair renders different params, same shape", () => {
  const dialect = new PgDialect();
  const { params } = dialect.sqlToQuery(productEventClientWhere("org-B", "user-B"));
  assert.deepEqual(params, ["org-B", "user-B"]);
});
