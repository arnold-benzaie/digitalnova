// Pure SQL-shape tests for the notifications visibility predicate — no live
// DB needed: PgDialect().sqlToQuery() renders the same SQL/params drizzle
// would send to Postgres, so this verifies the exact query shape a client
// vs a staff viewer gets. Run with: npx tsx --test lib/notification-visibility.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { PgDialect } from "drizzle-orm/pg-core";
import { notificationVisibilityWhere, STAFF_ONLY_NOTIFICATION_TYPES } from "./notification-visibility.ts";

const dialect = new PgDialect();
const render = (where) => dialect.sqlToQuery(where);

const EXPECTED_STAFF_ONLY_TYPES = [
  "user.pending_approval",
  "user.approved",
  "user.refused",
  "user.suspended",
  "user.reactivated",
  "user.role_changed",
  "user.organization_changed",
  "ticket.created",
  "invoice.sent",
  "invoice.delivery_failed",
];

test("STAFF_ONLY_NOTIFICATION_TYPES matches exactly the validated diagnostic list", () => {
  assert.deepEqual([...STAFF_ONLY_NOTIFICATION_TYPES].sort(), [...EXPECTED_STAFF_ONLY_TYPES].sort());
});

test("STAFF_ONLY_NOTIFICATION_TYPES never includes a *_self personal type", () => {
  assert.ok(!STAFF_ONLY_NOTIFICATION_TYPES.includes("user.approved_self"));
  assert.ok(!STAFF_ONLY_NOTIFICATION_TYPES.includes("user.refused_self"));
});

test("STAFF_ONLY_NOTIFICATION_TYPES never includes a known client-visible type", () => {
  for (const clientType of [
    "message.received",
    "document.uploaded",
    "onboarding.completed",
    "audit.generated",
    "report.generated",
    "gbp.synced",
    "analytics.synced",
    "search_console.synced",
    "billing.subscribed",
    "billing.canceled",
  ]) {
    assert.ok(!STAFF_ONLY_NOTIFICATION_TYPES.includes(clientType), `${clientType} must stay client-visible`);
  }
});

test("client role: SQL excludes staff-only types via NOT IN, keeps org-broadcast and personal branches", () => {
  const { sql, params } = render(notificationVisibilityWhere("org-1", "user-1", "client"));
  assert.match(sql, /"notifications"\."organization_id" = \$1/);
  assert.match(sql, /"notifications"\."user_id" is null/);
  assert.match(sql, /"notifications"\."type" not in/);
  assert.match(sql, /or "notifications"\."user_id" = \$\d+/);
  // organizationId, then every staff-only type, then userId — in that exact order.
  assert.deepEqual(params, ["org-1", ...STAFF_ONLY_NOTIFICATION_TYPES, "user-1"]);
});

test("client role: every staff-only type appears as a bound param (no hardcoded drift)", () => {
  const { params } = render(notificationVisibilityWhere("org-1", "user-1", "client"));
  for (const type of STAFF_ONLY_NOTIFICATION_TYPES) {
    assert.ok(params.includes(type), `${type} missing from the client NOT IN params`);
  }
});

for (const role of ["admin", "staff", "agent", "supervisor"]) {
  test(`${role} role: SQL has no type filter — identical shape to the pre-fix broadcast query (unchanged admin scope)`, () => {
    const { sql, params } = render(notificationVisibilityWhere("org-1", "user-1", role));
    assert.doesNotMatch(sql, /not in/);
    assert.equal(sql, '(("notifications"."organization_id" = $1 and "notifications"."user_id" is null) or "notifications"."user_id" = $2)');
    assert.deepEqual(params, ["org-1", "user-1"]);
  });
}

test("personal branch (userId = viewer) is present unconditionally, regardless of role", () => {
  for (const role of ["client", "admin", "staff", "agent", "supervisor"]) {
    const { sql } = render(notificationVisibilityWhere("org-1", "viewer-42", role));
    assert.match(sql, /or "notifications"\."user_id" = \$\d+/);
  }
});

test("organizationId is scoped per-call — a different org never leaks into another org's predicate", () => {
  const a = render(notificationVisibilityWhere("org-A", "user-1", "client"));
  const b = render(notificationVisibilityWhere("org-B", "user-1", "client"));
  assert.equal(a.params[0], "org-A");
  assert.equal(b.params[0], "org-B");
  assert.notEqual(a.params[0], b.params[0]);
});
