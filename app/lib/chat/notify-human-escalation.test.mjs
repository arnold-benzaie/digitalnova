// Unit tests for notifyHumanEscalation() — @/lib/notifications is mocked
// (same mock.module pattern already used elsewhere in this codebase for
// path-aliased internal modules, e.g. @/lib/session in
// chat.integration.test.mjs) so this never touches a real database. The
// email leg (lib/email/chat-notification.ts) is NOT mocked — it degrades
// to {sent:false} on its own, with zero network calls, whenever
// CHAT_NOTIFICATION_EMAIL/RESEND_API_KEY are unset, which they always
// are in this test environment. No real email is ever sent by this file.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

delete process.env.CHAT_NOTIFICATION_EMAIL;
delete process.env.RESEND_API_KEY;

/** @type {string | null} */
let internalOrgId = "org-internal-1";
/** @type {{ organizationId: string; userId?: string; type: string; metadata: Record<string, unknown> }[]} */
let notifyCalls = [];

mock.module("@/lib/notifications", {
  namedExports: {
    notify: async (input) => {
      notifyCalls.push(input);
    },
    getInternalOrganizationId: async () => internalOrgId,
  },
});

const { notifyHumanEscalation } = await import("@/lib/chat/notify-human-escalation");

test("lead_captured trigger raises a chat.lead_captured in-app notification with the right metadata", async () => {
  notifyCalls = [];
  await notifyHumanEscalation({ trigger: "lead_captured", conversationId: "conv-1", surface: "site", locale: "fr", fullName: "Jean Dupont", email: "jean@test.local" });
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].organizationId, "org-internal-1");
  assert.equal(notifyCalls[0].type, "chat.lead_captured");
  assert.equal(notifyCalls[0].metadata.conversationId, "conv-1");
  assert.equal(notifyCalls[0].metadata.fullName, "Jean Dupont");
});

test("human_requested trigger raises a chat.human_requested in-app notification with the right metadata", async () => {
  notifyCalls = [];
  await notifyHumanEscalation({ trigger: "human_requested", conversationId: "conv-2", surface: "app", locale: "en", actorName: "Alice", organizationName: "Acme" });
  assert.equal(notifyCalls.length, 1);
  assert.equal(notifyCalls[0].type, "chat.human_requested");
  assert.equal(notifyCalls[0].metadata.conversationId, "conv-2");
  assert.equal(notifyCalls[0].metadata.actorName, "Alice");
  assert.equal(notifyCalls[0].metadata.organizationName, "Acme");
});

test("never throws when no internal organization exists — skips the in-app notification, still returns cleanly", async () => {
  internalOrgId = null;
  notifyCalls = [];
  await assert.doesNotReject(() => notifyHumanEscalation({ trigger: "human_requested", conversationId: "conv-3", surface: "app", locale: "fr", actorName: "Bob" }));
  assert.equal(notifyCalls.length, 0);
  internalOrgId = "org-internal-1";
});

test("never throws when the email channel is unconfigured (degrades silently, matches every other transactional email in this app)", async () => {
  await assert.doesNotReject(() =>
    notifyHumanEscalation({ trigger: "lead_captured", conversationId: "conv-4", surface: "site", locale: "en", fullName: "Test User", email: "test@example.com" }),
  );
});
