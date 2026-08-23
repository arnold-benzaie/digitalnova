// Unit tests for sendChatNotificationEmail() — RESEND_API_KEY is
// deliberately never set, so lib/email/resend.ts's own resendClient()
// returns null and no real network call is ever possible from this
// suite, even when CHAT_NOTIFICATION_EMAIL is set to exercise the
// content-assembly path.
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });
delete process.env.RESEND_API_KEY;

const { sendChatNotificationEmail } = await import("@/lib/email/chat-notification");

test("no recipient configured -> sent:false, no content assembled", async () => {
  delete process.env.CHAT_NOTIFICATION_EMAIL;
  const result = await sendChatNotificationEmail({ kind: "lead_captured", conversationId: "conv-1", surface: "site", locale: "fr", fullName: "Jean" });
  assert.equal(result.sent, false);
});

test("recipient configured but RESEND_API_KEY missing -> still sent:false, never throws, no real network call", async () => {
  process.env.CHAT_NOTIFICATION_EMAIL = "staff@example.test";
  await assert.doesNotReject(async () => {
    const result = await sendChatNotificationEmail({ kind: "human_requested", conversationId: "conv-2", surface: "app", locale: "en", actorName: "Alice" });
    assert.equal(result.sent, false);
  });
  delete process.env.CHAT_NOTIFICATION_EMAIL;
});

test("multiple comma-separated recipients are all attempted (each still degrades to unsent without a real key)", async () => {
  process.env.CHAT_NOTIFICATION_EMAIL = "a@example.test, b@example.test";
  const result = await sendChatNotificationEmail({ kind: "lead_captured", conversationId: "conv-3", surface: "site", locale: "fr", fullName: "Test" });
  assert.equal(result.sent, false);
  delete process.env.CHAT_NOTIFICATION_EMAIL;
});
