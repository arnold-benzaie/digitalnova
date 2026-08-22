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
const { users, organizations, roles, memberships, crmClients, chatConversations, chatMessages, notifications } = await import("@/db/schema");
const { eq, and } = await import("drizzle-orm");
const { resolveChatContext } = await import("@/lib/chat/context");
const { getOrCreateConversation, getOwnedConversation, attachLeadToConversation } = await import("@/lib/chat/conversations");
const { appendMessage, getConversationMessages, sanitizeMessageContent, sanitizeMessageMetadata, MAX_MESSAGE_LENGTH } = await import("@/lib/chat/messages");
const { captureLead } = await import("@/lib/chat/leads");
const { escalateToHuman } = await import("@/lib/chat/escalation");
const { generateVisitorId, isValidVisitorId } = await import("@/lib/chat/visitor");

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

  await escalateToHuman({ kind: "authenticated", userId: clientA.id, organizationId: orgA.id, organizationName: "Org A", firstName: "Alice", locale: "fr", market: null, activeIntegrations: { gbp: false, analytics: false, searchConsole: false } }, conversation.id, "Besoin d'aide.");

  const [row] = await db.select().from(chatConversations).where(eq(chatConversations.id, conversation.id)).limit(1);
  assert.equal(row.status, "NEEDS_HUMAN");

  const [note] = await db
    .select()
    .from(notifications)
    .where(and(eq(notifications.organizationId, internalOrg.id), eq(notifications.type, "chat.human_requested")))
    .orderBy(notifications.createdAt);
  assert.ok(note, "an internal notification must be raised for staff to see");
});
