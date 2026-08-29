// PHASE 2B.0 — authorization hotfix for lib/actions/crm-calendar.ts.
// createCalendarEvent / updateCalendarEvent / deleteCalendarEvent now each
// call requireStaffRole() first. Real requireStaffRole() runs against a
// faked requireSession(). Local disposable Docker Postgres only.
//
// Run: npx tsx --test --experimental-test-module-mocks lib/actions/crm-calendar-auth.integration.test.mjs
import { test, mock, beforeEach, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
if (/supabase|neon|pooler/i.test(LOCAL_DB_URL)) throw new Error("REFUS : base non locale.");
process.env.DATABASE_URL = LOCAL_DB_URL;

mock.module("server-only", { defaultExport: {} });
mock.module("next/cache", { namedExports: { revalidatePath: () => {} } });

const STAFF_SESSION = {
  userId: "test-staff-user", clerkUserId: "test_clerk_staff", email: "staff@example.com",
  fullName: "Test Staff", firstName: "Test", organizationId: "test-org", organizationName: "Test Org",
  role: "staff", previousLastLoginAt: null,
};
const CLIENT_SESSION = { ...STAFF_SESSION, userId: "test-client-user", email: "client-role@example.com", role: "client" };
let mockState = { session: STAFF_SESSION };
const actAsStaff = () => { mockState = { session: STAFF_SESSION }; };
const actAsClient = () => { mockState = { session: CLIENT_SESSION }; };
mock.module("@/lib/session", { namedExports: { requireSession: async () => mockState.session, getCurrentSession: async () => null } });

const { db } = await import("@/db");
const { calendarEvents } = await import("@/db/schema");
const { eq, inArray } = await import("drizzle-orm");
const { createCalendarEvent, updateCalendarEvent, deleteCalendarEvent } = await import("./crm-calendar.ts");

const createdIds = new Set();
beforeEach(() => actAsStaff());
after(async () => {
  if (createdIds.size) await db.delete(calendarEvents).where(inArray(calendarEvents.id, [...createdIds]));
  await db.$client.end();
});

const TITLE = `2B0-cal ${randomUUID()}`;
async function makeEvent(overrides = {}) {
  const [e] = await db.insert(calendarEvents).values({ title: "seed", startAt: new Date(), ...overrides }).returning();
  createdIds.add(e.id);
  return e;
}
const row = async (id) => (await db.select().from(calendarEvents).where(eq(calendarEvents.id, id)).limit(1))[0];
const countByTitle = async (t) => (await db.select().from(calendarEvents).where(eq(calendarEvents.title, t))).length;
function form(overrides = {}) {
  const fd = new FormData();
  fd.set("title", overrides.title ?? TITLE);
  fd.set("startAt", overrides.startAt ?? new Date().toISOString());
  return fd;
}

test("createCalendarEvent — client rejected, zero row side effect", async () => {
  actAsClient();
  try { await assert.rejects(() => createCalendarEvent(form())); } finally { actAsStaff(); }
  assert.equal(await countByTitle(TITLE), 0);
});
test("createCalendarEvent — staff still works", async () => {
  await createCalendarEvent(form({ title: `${TITLE}-ok` }));
  const rows = await db.select().from(calendarEvents).where(eq(calendarEvents.title, `${TITLE}-ok`));
  rows.forEach((r) => createdIds.add(r.id));
  assert.equal(rows.length, 1);
});
test("updateCalendarEvent — client rejected, row unchanged", async () => {
  const e = await makeEvent({ title: "original" });
  actAsClient();
  try { await assert.rejects(() => updateCalendarEvent(e.id, form({ title: "forgé" }))); } finally { actAsStaff(); }
  assert.equal((await row(e.id)).title, "original");
});
test("updateCalendarEvent — staff still works", async () => {
  const e = await makeEvent({ title: "original" });
  const updated = await updateCalendarEvent(e.id, form({ title: "modifié" }));
  assert.equal(updated.title, "modifié");
});
test("deleteCalendarEvent — client rejected, row still exists", async () => {
  const e = await makeEvent();
  actAsClient();
  try { await assert.rejects(() => deleteCalendarEvent(e.id)); } finally { actAsStaff(); }
  assert.ok(await row(e.id));
});
test("deleteCalendarEvent — staff still works", async () => {
  const e = await makeEvent();
  createdIds.delete(e.id);
  await deleteCalendarEvent(e.id);
  assert.equal(await row(e.id), undefined);
});
