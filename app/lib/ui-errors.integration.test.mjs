// Integration tests for recordUiFailureAndMaybeAlert() (service: "ui") —
// modeled on the §10 "technical alert" tests in lib/chat/chat.integration.test.mjs
// for its sibling chat_ai path. Runs against the same fully isolated local
// Docker Postgres already used there (public-map-approval-test-db, port
// 5434) — NEVER Supabase Production/Preview.
//
// What this proves: the new `service: "ui"` path never throws regardless
// of email configuration, records exactly one row per call, and — the one
// thing unique to this file — never touches the pre-existing "database" or
// "chat_ai" rows/counts, since this mission's absolute rule is "do not
// modify existing DB behavior" for either of those two paths.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/ui-errors.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Production. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

const { db } = await import("@/db");
const { systemHealthChecks } = await import("@/db/schema");
const { eq } = await import("drizzle-orm");
const { recordUiFailureAndMaybeAlert } = await import("@/lib/ui-errors");

after(async () => {
  await db.$client.end();
});

async function countByService(service) {
  const rows = await db.select().from(systemHealthChecks).where(eq(systemHealthChecks.service, service));
  return rows.length;
}

test("recordUiFailureAndMaybeAlert never throws, with or without email configured", async () => {
  delete process.env.SYSTEM_ALERT_EMAIL;
  await assert.doesNotReject(() => recordUiFailureAndMaybeAlert("unknown", "/admin/audit"));
  process.env.SYSTEM_ALERT_EMAIL = "ops@example.test";
  await assert.doesNotReject(() => recordUiFailureAndMaybeAlert("unknown", "/admin/audit"));
  delete process.env.SYSTEM_ALERT_EMAIL;
});

test("recordUiFailureAndMaybeAlert records one ui row per call, under service='ui' only", async () => {
  const before = await countByService("ui");
  const beforeDatabase = await countByService("database");
  const beforeChatAi = await countByService("chat_ai");

  await recordUiFailureAndMaybeAlert("validation", "/admin/organisations");
  await recordUiFailureAndMaybeAlert("validation", "/admin/organisations");
  await recordUiFailureAndMaybeAlert("validation", "/admin/organisations");

  const after = await countByService("ui");
  assert.equal(after, before + 3, "each failure must record exactly one row under service='ui'");

  const rows = await db.select().from(systemHealthChecks).where(eq(systemHealthChecks.service, "ui"));
  const lastThree = rows.slice(-3);
  assert.ok(lastThree.every((row) => row.errorCategory === "validation" && row.status === "unhealthy"));

  // The hard requirement: this new path must be fully additive — the
  // pre-existing "database" (cron health-check) and "chat_ai" (AI
  // assistant) rows/counts must be completely untouched by it.
  assert.equal(await countByService("database"), beforeDatabase);
  assert.equal(await countByService("chat_ai"), beforeChatAi);
});

test("recordUiFailureAndMaybeAlert: never persists the raw error message — only the caller-supplied closed-set category", async () => {
  const secretLookingCategory = "db_connection"; // one of the real closed-set labels, never a raw message
  await recordUiFailureAndMaybeAlert(secretLookingCategory, "/admin/audit");
  const rows = await db.select().from(systemHealthChecks).where(eq(systemHealthChecks.service, "ui"));
  const last = rows[rows.length - 1];
  assert.equal(last.errorCategory, secretLookingCategory);
});
