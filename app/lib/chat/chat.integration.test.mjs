// Integration tests for the AI Assistant widget backend (2026-08, Phase
// 1A) — proves, against a real Postgres database, that: an authenticated
// context resolves organizationId/userId/firstName exclusively from the
// server-side session (never trusted from a caller); an anonymous
// visitor's conversation is scoped to its visitorId only; a conversation
// cannot be accessed/hijacked by forging its id from another org or
// another visitor; a lead capture reuses an existing crmClients row by
// email instead of duplicating it; a human-escalation request flips the
// conversation status and raises an internal notification.
//
// Runs against the same fully isolated local Docker Postgres already used
// by lib/product-events.integration.test.mjs (public-map-approval-test-db,
// port 5434) — NEVER Supabase Production/Preview. Same mocking strategy:
// only @/lib/session's getCurrentSession() is faked; every lib/chat/*
// module runs entirely unmodified against the real local database.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/chat/chat.integration.test.mjs
import { test, mock, after } from "node:test";
import assert from "node:assert/strict";
import { randomUUID } from "node:crypto";

mock.module("server-only", { namedExports: {} });

const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Production. Arrêt avant tout import applicatif.");
}
process.env.DATABASE_URL = LOCAL_DB_URL;

/** @type {null | { userId: string; clerkUserId: string; email: string; fullName: string | null; firstName: string | null; organizationId: string; organizationName: string; role: string; previousLastLoginAt: null }} */
let mockSession = null;

mock.module("@/lib/session", {
  namedExports: {
    getCurrentSession: async () => mockSession,
  },
});

const { db } = await import("@/db");
const { users, organizations, roles, memberships, crmClients, chatConversations, chatMessages, notifications, systemHealthChecks } = await import("@/db/schema");
const { eq, and, sql } = await import("drizzle-orm");
const { resolveChatContext } = await import("@/lib/chat/context");
const { getOrCreateConversation, getOwnedConversation, attachLeadToConversation } = await import("@/lib/chat/conversations");
const {
  appendMessage,
  appendUserMessage,
  getConversationMessages,
  sanitizeMessageContent,
  sanitizeMessageMetadata,
  MAX_MESSAGE_LENGTH,
  getLeadSubmitCooldownRemainingMs,
  LEAD_SUBMIT_COOLDOWN_MS,
} = await import("@/lib/chat/messages");
const { captureLead } = await import("@/lib/chat/leads");
const { escalateToHuman } = await import("@/lib/chat/escalation");
const { generateVisitorId, isValidVisitorId } = await import("@/lib/chat/visitor");
const { recordChatFailureAndMaybeAlert, categorizeChatError } = await import("@/lib/chat/technical-alert");

after(async () => {
  await db.$client.end();
});

// ---- fixtures -------------------------------------------------------

async function roleId(name) {
  const [role] = await db.select().from(roles).where(eq(roles.name, name)).limit(1);
  if (!role) throw new Error(`Rôle "${name}" introuvable.`);
  return role.id;
}

async function createOrg(overrides = {}) {
  const [org] = await db.insert(organizations).values({ name: `Org Test ${randomUUID()}`, ...overrides }).returning();
  return org;
}

async function createMember({ role, organizationId, firstName = "Test" }) {
  const [user] = await db
    .insert(users)
    .values({ clerkUserId: `test_clerk_${randomUUID()}`, email: `${randomUUID()}@test.local`, fullName: `${firstName} Fixture`, firstName, status: "active" })
    .returning();
  await db.insert(memberships).values({ userId: user.id, organizationId, roleId: await roleId(role) });
  return user;
}

function actAs(user, organizationId, organizationName = "Org") {
  mockSession = { userId: user.id, clerkUserId: user.clerkUserId, email: user.email, fullName: user.fullName, firstName: user.firstName, organizationId, organizationName, role: "client", previousLastLoginAt: null };
}

function actAsAnonymous() {
  mockSession = null;
}

const orgA = await createOrg();
const orgB = await createOrg();
const clientA = await createMember({ role: "client", organizationId: orgA.id, firstName: "Alice" });
const clientB = await createMember({ role: "client", organizationId: orgB.id, firstName: "Bob" });

// Ensure exactly one internal org exists for this test run (partial
// unique index — reuse if a previous run already created one).
let internalOrg = (await db.select().from(organizations).where(eq(organizations.isInternal, true)).limit(1))[0];
if (!internalOrg) {
  internalOrg = await createOrg({ isInternal: true });
}

// ---- visitor id -------------------------------------------------------

test("generateVisitorId produces a value isValidVisitorId accepts, and rejects garbage", () => {
  const id = generateVisitorId();
  assert.ok(isValidVisitorId(id));
  assert.equal(isValidVisitorId("not-a-visitor-id"), false);
  assert.equal(isValidVisitorId(undefined), false);
  assert.equal(isValidVisitorId(null), false);
});

// ---- context resolution -------------------------------------------------

test("resolveChatContext: authenticated session resolves organizationId/userId/firstName from the server, never from the caller", async () => {
  actAs(clientA, orgA.id);
  const context = await resolveChatContext("fr", "unused-visitor-id");
  assert.equal(context.kind, "authenticated");
  assert.equal(context.organizationId, orgA.id);
  assert.equal(context.userId, clientA.id);
  assert.equal(context.firstName, "Alice");
});

test("resolveChatContext: no session -> anonymous context carrying only the given visitorId", async () => {
  actAsAnonymous();
  const visitorId = generateVisitorId();
  const context = await resolveChatContext("en", visitorId);
  assert.deepEqual(context, { kind: "anonymous", visitorId, locale: "en" });
});

// ---- conversations: creation + ownership isolation ---------------------

test("getOrCreateConversation: authenticated user gets an org/user-scoped conversation", async () => {
  actAs(clientA, orgA.id);
  const context = await resolveChatContext("fr", "unused");
  const conversation = await getOrCreateConversation(context);
  assert.equal(conversation.organizationId, orgA.id);
  assert.equal(conversation.userId, clientA.id);
  assert.equal(conversation.visitorId, null);
  assert.equal(conversation.status, "AI_HANDLED");
});

test("getOrCreateConversation: anonymous visitor gets a visitorId-scoped conversation, no organization/user", async () => {
  actAsAnonymous();
  const visitorId = generateVisitorId();
  const context = await resolveChatContext("fr", visitorId);
  const conversation = await getOrCreateConversation(context);
  assert.equal(conversation.organizationId, null);
  assert.equal(conversation.userId, null);
  assert.equal(conversation.visitorId, visitorId);
});

test("Org A cannot resume Org B's conversation by supplying its id — a fresh conversation is created instead, never an error that would confirm it exists", async () => {
  actAs(clientB, orgB.id);
  const contextB = await resolveChatContext("fr", "unused");
  const conversationB = await getOrCreateConversation(contextB);

  actAs(clientA, orgA.id);
  const contextA = await resolveChatContext("fr", "unused");
  const result = await getOrCreateConversation(contextA, conversationB.id);

  assert.notEqual(result.id, conversationB.id, "Org A must never be handed Org B's conversation");
  assert.equal(result.organizationId, orgA.id);
});

test("An anonymous visitor cannot read another visitor's conversation by guessing/forging its id", async () => {
  actAsAnonymous();
  const visitorX = generateVisitorId();
  const contextX = await resolveChatContext("fr", visitorX);
  const conversationX = await getOrCreateConversation(contextX);

  const visitorY = generateVisitorId();
  const contextY = await resolveChatContext("fr", visitorY);
  const owned = await getOwnedConversation(contextY, conversationX.id);
  assert.equal(owned, null);
});

test("An anonymous visitor cannot access an authenticated user's conversation, and vice versa", async () => {
  actAs(clientA, orgA.id);
  const contextA = await resolveChatContext("fr", "unused");
  const conversationA = await getOrCreateConversation(contextA);

  actAsAnonymous();
  const visitor = generateVisitorId();
  const contextVisitor = await resolveChatContext("fr", visitor);
  assert.equal(await getOwnedConversation(contextVisitor, conversationA.id), null);

  const conversationVisitor = await getOrCreateConversation(contextVisitor);
  actAs(clientA, orgA.id);
  assert.equal(await getOwnedConversation(await resolveChatContext("fr", "unused"), conversationVisitor.id), null);
});

// ---- messages -----------------------------------------------------------

test("appendMessage stores the message and getConversationMessages returns it oldest-first", async () => {
  actAs(clientA, orgA.id);
  const conversation = await getOrCreateConversation(await resolveChatContext("fr", "unused"));
  await appendMessage(conversation.id, "client", "Bonjour");
  await appendMessage(conversation.id, "assistant", "Bonjour ! Comment puis-je vous aider ?");

  const rows = await getConversationMessages(conversation.id);
  assert.equal(rows.length, 2);
  assert.equal(rows[0].senderType, "client");
  assert.equal(rows[1].senderType, "assistant");
});

test("sanitizeMessageContent trims and caps at MAX_MESSAGE_LENGTH", () => {
  assert.equal(sanitizeMessageContent("  hello  "), "hello");
  const long = "a".repeat(MAX_MESSAGE_LENGTH + 500);
  assert.equal(sanitizeMessageContent(long).length, MAX_MESSAGE_LENGTH);
});

test("sanitizeMessageMetadata drops forbidden keys (token/secret/password/...) and caps count/length", () => {
  const result = sanitizeMessageMetadata({ suggestionId: "google_ads", accessToken: "should-never-survive", refreshToken: "nope", ok: true });
  assert.deepEqual(result, { suggestionId: "google_ads", ok: true });
});

test("appendMessage never persists a forbidden metadata key even if a caller tries to smuggle one in", async () => {
  actAs(clientA, orgA.id);
  const conversation = await getOrCreateConversation(await resolveChatContext("fr", "unused"));
  await appendMessage(conversation.id, "client", "test", { apiKey: "sk-should-not-be-stored", suggestionId: "human" });
  const [row] = await db.select().from(chatMessages).where(eq(chatMessages.conversationId, conversation.id)).orderBy(chatMessages.createdAt);
  assert.deepEqual(row.metadata, { suggestionId: "human" });
});

// ---- leads: capture + dedup ----------------------------------------------

test("captureLead creates a crmClients row with stage=lead, source='chat widget'", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const email = `${randomUUID()}@lead.test`;
  const { crmClientId, reused } = await captureLead(context, { fullName: "Jean Dupont", email, message: "Je veux améliorer mon SEO." });
  assert.equal(reused, false);

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, crmClientId)).limit(1);
  assert.equal(row.stage, "lead");
  assert.equal(row.source, "chat widget");
  assert.equal(row.email, email.toLowerCase());
  assert.equal(row.organizationId, null);
});

// §Phase 1D — booking/lead form's requestType/preferredDate/preferredTimeSlot:
// no schema change (see request-type-catalog.ts's header comment), just
// structured, clearly-labeled lines appended to the same free-text
// `notes` field captureLead already writes to.
test("captureLead records requestType/preferredDate/preferredTimeSlot as labeled, non-confirmed preferences inside notes — no new columns", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const email = `${randomUUID()}@lead.test`;
  const { crmClientId } = await captureLead(context, {
    fullName: "Booking Test",
    email,
    message: "Je souhaite réserver un créneau.",
    requestType: "meeting",
    preferredDate: "2026-09-01",
    preferredTimeSlot: "après-midi",
  });

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, crmClientId)).limit(1);
  assert.match(row.notes, /Type de demande : Réserver un rendez-vous/);
  assert.match(row.notes, /Date souhaitée \(préférence, non confirmée\) : 2026-09-01/);
  assert.match(row.notes, /Créneau souhaité \(préférence, non confirmée\) : après-midi/);
});

test("captureLead without requestType/preferredDate/preferredTimeSlot behaves exactly as before (existing advisor-CTA flow, unchanged)", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const email = `${randomUUID()}@lead.test`;
  const { crmClientId } = await captureLead(context, { fullName: "No Booking Fields", email, message: "Je veux parler à un conseiller." });

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, crmClientId)).limit(1);
  assert.equal(row.notes, "[Chat widget] Je veux parler à un conseiller.");
});

// §Phase 1F — phone: stored as-is (E.164) in crmClients.phone (existing
// column, no migration); the derived country/dial-code is appended to
// `notes`, same append-only pattern as requestType/preferredDate above.
test("captureLead stores an E.164 phone in crmClients.phone and appends its derived country to notes", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const email = `${randomUUID()}@lead.test`;
  const { crmClientId } = await captureLead(context, { fullName: "Phone Test", email, message: "Rappelez-moi.", phone: "+230 5712 3456".replace(/\s/g, "") });

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, crmClientId)).limit(1);
  assert.equal(row.phone, "+23057123456");
  assert.match(row.notes, /Téléphone — pays : Maurice \(\+230\)/);
});

test("captureLead without a phone leaves crmClients.phone null and adds no phone line to notes", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const email = `${randomUUID()}@lead.test`;
  const { crmClientId } = await captureLead(context, { fullName: "No Phone", email, message: "Sans téléphone." });

  const [row] = await db.select().from(crmClients).where(eq(crmClients.id, crmClientId)).limit(1);
  assert.equal(row.phone, null);
  assert.equal(row.notes, "[Chat widget] Sans téléphone.");
});

test("captureLead reuses an existing crmClients row for the same email instead of creating a duplicate", async () => {
  actAsAnonymous();
  const email = `${randomUUID()}@lead.test`;
  const context1 = await resolveChatContext("fr", generateVisitorId());
  const first = await captureLead(context1, { fullName: "Marie Curie", email, message: "Premier message." });

  const context2 = await resolveChatContext("fr", generateVisitorId());
  const second = await captureLead(context2, { fullName: "Marie Curie", email: email.toUpperCase(), message: "Deuxième message, même personne." });

  assert.equal(second.reused, true);
  assert.equal(second.crmClientId, first.crmClientId);

  const rows = await db.select().from(crmClients).where(eq(crmClients.email, email.toLowerCase()));
  assert.equal(rows.length, 1, "no duplicate crmClients row should exist for the same email");
});

test("attachLeadToConversation links the conversation once, and never overwrites an already-linked lead", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const conversation = await getOrCreateConversation(context);
  const { crmClientId: firstLeadId } = await captureLead(context, { fullName: "A", email: `${randomUUID()}@a.test`, message: "m" });
  const { crmClientId: secondLeadId } = await captureLead(context, { fullName: "B", email: `${randomUUID()}@b.test`, message: "m" });

  await attachLeadToConversation(conversation.id, firstLeadId);
  await attachLeadToConversation(conversation.id, secondLeadId);

  const [row] = await db.select().from(chatConversations).where(eq(chatConversations.id, conversation.id)).limit(1);
  assert.equal(row.crmClientId, firstLeadId, "the first successfully attached lead must never be silently replaced");
});

// ---- human escalation -----------------------------------------------------

test("escalateToHuman sets status=NEEDS_HUMAN and raises an internal notification", async () => {
  actAs(clientA, orgA.id);
  const conversation = await getOrCreateConversation(await resolveChatContext("fr", "unused"));

  await escalateToHuman(
    { kind: "authenticated", userId: clientA.id, organizationId: orgA.id, organizationName: "Org A", firstName: "Alice", locale: "fr", market: null, activeIntegrations: { gbp: false, analytics: false, searchConsole: false } },
    conversation,
    "app",
    "Besoin d'aide.",
  );

  const [row] = await db.select().from(chatConversations).where(eq(chatConversations.id, conversation.id)).limit(1);
  assert.equal(row.status, "NEEDS_HUMAN");

  const notes = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, internalOrg.id), eq(notifications.type, "chat.human_requested")))
    .orderBy(notifications.createdAt);
  const forThisConversation = notes.filter((n) => n.metadata && n.metadata.conversationId === conversation.id);
  assert.equal(forThisConversation.length, 1, "an internal notification must be raised for staff to see");
});

test("escalateToHuman is a no-op notification-wise when the conversation is already NEEDS_HUMAN (§8 anti-spam dedup)", async () => {
  actAs(clientA, orgA.id);
  const context = { kind: "authenticated", userId: clientA.id, organizationId: orgA.id, organizationName: "Org A", firstName: "Alice", locale: "fr", market: null, activeIntegrations: { gbp: false, analytics: false, searchConsole: false } };
  const conversation = await getOrCreateConversation(await resolveChatContext("fr", "unused"));

  await escalateToHuman(context, conversation, "app", "Première demande.");
  const [afterFirst] = await db.select().from(chatConversations).where(eq(chatConversations.id, conversation.id)).limit(1);

  // Second call passes the now-NEEDS_HUMAN row, exactly as route.ts would
  // (it re-fetches via getOwnedConversation before every write).
  await escalateToHuman(context, afterFirst, "app", "Deuxième demande, quelques secondes plus tard.");

  const notes = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, internalOrg.id), eq(notifications.type, "chat.human_requested")))
    .orderBy(notifications.createdAt);
  const forThisConversation = notes.filter((n) => n.metadata && n.metadata.conversationId === conversation.id);
  assert.equal(forThisConversation.length, 1, "a second escalation on an already-NEEDS_HUMAN conversation must not raise a second notification");
});

// ---- anti-duplication: appendUserMessage (§13, Retry dedup) --------------

test("appendUserMessage: an identical retry within the dedup window reuses the same row instead of creating a second one", async () => {
  actAs(clientA, orgA.id);
  const conversation = await getOrCreateConversation(await resolveChatContext("fr", "unused"));

  const first = await appendUserMessage(conversation.id, "client", "Bonjour, j'ai un problème.");
  const retried = await appendUserMessage(conversation.id, "client", "Bonjour, j'ai un problème.");

  assert.equal(retried.id, first.id, "a retry of the exact same content must reuse the original row");
  const rows = await getConversationMessages(conversation.id);
  assert.equal(rows.filter((r) => r.content === "Bonjour, j'ai un problème.").length, 1, "no duplicate row should be persisted");
});

test("appendUserMessage: different content on the same conversation is never deduped", async () => {
  actAs(clientA, orgA.id);
  const conversation = await getOrCreateConversation(await resolveChatContext("fr", "unused"));

  await appendUserMessage(conversation.id, "client", "Premier message.");
  await appendUserMessage(conversation.id, "client", "Un message différent.");

  const rows = await getConversationMessages(conversation.id);
  assert.equal(rows.length, 2);
});

test("appendUserMessage: a same-content row from a DIFFERENT senderType (e.g. the assistant echoing the visitor's words) never triggers the dedup — only an exact senderType+content match on the single most recent row does", async () => {
  actAs(clientA, orgA.id);
  const conversation = await getOrCreateConversation(await resolveChatContext("fr", "unused"));

  const clientRow = await appendUserMessage(conversation.id, "client", "Même texte");
  await appendMessage(conversation.id, "assistant", "Même texte");
  const secondClientRow = await appendUserMessage(conversation.id, "client", "Même texte");

  const rows = await getConversationMessages(conversation.id);
  assert.equal(rows.length, 3, "all three inserts must persist — the assistant row's matching content never dedupes the client's own later turn");
  assert.notEqual(secondClientRow.id, clientRow.id, "the second client row is genuinely new, not a reuse of the first");
});

// ---- lead notification cooldown (§Phase 1H) --------------------------------
// Replaces the old permanent "conversation.crmClientId !== null" guard,
// which blocked a notification forever after the first one — even for a
// genuinely new request days later. Mirrors app/api/chat/route.ts's real
// handleLeadSubmit sequence directly against the DB, without spinning up
// the HTTP route: check cooldown -> if clear, tag+append the confirmation
// message BEFORE captureLead/attach (narrows the double-submit race
// window) -> captureLead (its own email-based dedup is unrelated and
// always runs) -> attach -> "would notify" if cooldown was clear.

async function submitLead(context, conversation, { message, fullName = "Cooldown Test", email }) {
  const cooldownRemainingMs = await getLeadSubmitCooldownRemainingMs(conversation.id);
  if (cooldownRemainingMs > 0) {
    return { cooldownRemainingMs, notified: false, crmClientId: null };
  }
  await appendMessage(conversation.id, "assistant", "Merci. Votre nouvelle demande a bien été transmise à PUBLIC-MAP.", { kind: "lead_submit" });
  const { crmClientId } = await captureLead(context, { fullName, email, message });
  await attachLeadToConversation(conversation.id, crmClientId);
  return { cooldownRemainingMs: 0, notified: true, crmClientId };
}

test("lead_submit cooldown: a second submission in the same conversation within 90s is blocked (no notification), the first is not", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const conversation = await getOrCreateConversation(context);
  const email = `${randomUUID()}@cooldown.test`;

  const first = await submitLead(context, conversation, { message: "Premier envoi.", email });
  const second = await submitLead(context, conversation, { message: "Renvoi quelques secondes plus tard.", email });

  assert.equal(first.notified, true, "the first submission must be treated as new (notification would fire)");
  assert.equal(second.notified, false, "an immediate resubmit on the same conversation must be blocked by the cooldown");
  assert.ok(second.cooldownRemainingMs > 0 && second.cooldownRemainingMs <= LEAD_SUBMIT_COOLDOWN_MS, "remaining cooldown must be a sane positive value at or under the full window");
});

test("lead_submit cooldown: once the tagged message is older than 90s, a new submission on the SAME conversation is accepted, reuses the same crmClient, and both notes are traceable separately", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const conversation = await getOrCreateConversation(context);
  const email = `${randomUUID()}@cooldown.test`;

  const first = await submitLead(context, conversation, { message: "Rendez-vous le 26 août à 10h30.", email });
  assert.equal(first.notified, true);

  // Simulate "91 seconds have passed" by backdating the tagged message's
  // createdAt directly — waiting 90 real seconds in an automated suite
  // isn't practical. Same technique already implied by this file's own
  // time-window tests elsewhere (appendUserMessage's DUPLICATE_WINDOW_MS).
  const backdated = new Date(Date.now() - (LEAD_SUBMIT_COOLDOWN_MS + 1000));
  await db.update(chatMessages).set({ createdAt: backdated }).where(and(eq(chatMessages.conversationId, conversation.id), sql`${chatMessages.metadata} @> '{"kind":"lead_submit"}'::jsonb`));

  const second = await submitLead(context, conversation, { message: "Changement de rendez-vous au 27 août à 14h.", email });
  assert.equal(second.notified, true, "past the 90s cooldown, the same conversation must be able to submit a new notified request");
  assert.equal(second.crmClientId, first.crmClientId, "the same crmClient must be reused (email-based dedup), never duplicated");

  const [clientRow] = await db.select().from(crmClients).where(eq(crmClients.id, first.crmClientId)).limit(1);
  assert.match(clientRow.notes, /Rendez-vous le 26 août à 10h30/, "the first request stays in notes");
  assert.match(clientRow.notes, /Changement de rendez-vous au 27 août à 14h/, "the second, later-accepted request is appended as a separately traceable entry");
});

test("lead_submit cooldown: a different, brand-new conversation is never affected by another conversation's cooldown", async () => {
  actAsAnonymous();
  const contextA = await resolveChatContext("fr", generateVisitorId());
  const conversationA = await getOrCreateConversation(contextA);
  await submitLead(contextA, conversationA, { message: "Demande A.", email: `${randomUUID()}@cooldown.test` });

  actAsAnonymous();
  const contextB = await resolveChatContext("fr", generateVisitorId());
  const conversationB = await getOrCreateConversation(contextB);
  const resultB = await submitLead(contextB, conversationB, { message: "Demande B, autre client.", email: `${randomUUID()}@cooldown.test` });

  assert.equal(resultB.notified, true, "a fresh, unrelated conversation must never be blocked by a cooldown that belongs to a different conversation");
});

test("lead_submit cooldown: getLeadSubmitCooldownRemainingMs returns 0 for a conversation that has never had a notified submission", async () => {
  actAsAnonymous();
  const context = await resolveChatContext("fr", generateVisitorId());
  const conversation = await getOrCreateConversation(context);
  assert.equal(await getLeadSubmitCooldownRemainingMs(conversation.id), 0);
});

// ---- technical alert (§10) --------------------------------------------------
// SYSTEM_ALERT_EMAIL/RESEND_API_KEY are never set in this test environment,
// so sendChatAlertEmail() always degrades to {sent:false} with zero real
// network calls — meaning alertSentAt never actually gets stamped here.
// This mirrors the codebase's own existing precedent: there is no test
// file at all for lib/system-alerts.ts's analogous DB-alert cooldown,
// for the same reason (fully exercising the cooldown-after-a-real-send
// path needs live provider credentials). What IS verified here is the
// part that doesn't depend on a real send: recording never throws, and
// failures actually accumulate as chat_ai rows for the threshold check.

test("recordChatFailureAndMaybeAlert never throws, with or without email configured", async () => {
  delete process.env.SYSTEM_ALERT_EMAIL;
  await assert.doesNotReject(() => recordChatFailureAndMaybeAlert("provider_unavailable", "/api/chat"));
  process.env.SYSTEM_ALERT_EMAIL = "ops@example.test";
  await assert.doesNotReject(() => recordChatFailureAndMaybeAlert("provider_unavailable", "/api/chat"));
  delete process.env.SYSTEM_ALERT_EMAIL;
});

test("recordChatFailureAndMaybeAlert records one chat_ai row per call, using categorizeChatError's own category", async () => {
  const before = await db.select().from(systemHealthChecks).where(eq(systemHealthChecks.service, "chat_ai"));
  const category = categorizeChatError(new Error("ai-deepseek-provider: invalid_json"));

  await recordChatFailureAndMaybeAlert(category, "/api/chat");
  await recordChatFailureAndMaybeAlert(category, "/api/chat");
  await recordChatFailureAndMaybeAlert(category, "/api/chat");

  const after = await db.select().from(systemHealthChecks).where(eq(systemHealthChecks.service, "chat_ai"));
  assert.equal(after.length, before.length + 3, "each failure must record exactly one row");
  const lastThree = after.slice(-3);
  assert.ok(lastThree.every((row) => row.errorCategory === "invalid_json" && row.status === "unhealthy"));
});
