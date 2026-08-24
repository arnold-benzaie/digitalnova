import { test } from "node:test";
import assert from "node:assert/strict";
import { chatRequestSchema } from "@/lib/chat/validation";
import { MAX_MESSAGE_LENGTH } from "@/lib/chat/message-sanitization";

test("a valid 'message' payload parses successfully", () => {
  const result = chatRequestSchema.safeParse({ type: "message", content: "Bonjour", locale: "fr" });
  assert.equal(result.success, true);
});

test("a message over MAX_MESSAGE_LENGTH is rejected", () => {
  const result = chatRequestSchema.safeParse({ type: "message", content: "a".repeat(MAX_MESSAGE_LENGTH + 1), locale: "fr" });
  assert.equal(result.success, false);
});

test("an empty message is rejected", () => {
  const result = chatRequestSchema.safeParse({ type: "message", content: "   ", locale: "fr" });
  assert.equal(result.success, false);
});

test("an invalid locale is rejected", () => {
  const result = chatRequestSchema.safeParse({ type: "message", content: "hi", locale: "de" });
  assert.equal(result.success, false);
});

test("an unknown 'type' discriminator is rejected", () => {
  const result = chatRequestSchema.safeParse({ type: "delete_everything", content: "hi", locale: "fr" });
  assert.equal(result.success, false);
});

test("a malformed/missing payload (not even an object) is rejected, not thrown", () => {
  const result = chatRequestSchema.safeParse("just a string");
  assert.equal(result.success, false);
});

test("lead_submit requires consent to be literally true — a falsy/missing value is rejected", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", email: "a@b.com", requestType: "other", message: "hi" };
  assert.equal(chatRequestSchema.safeParse({ ...base, consent: false }).success, false);
  assert.equal(chatRequestSchema.safeParse(base).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...base, consent: true }).success, true);
});

test("lead_submit requires a valid email", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", requestType: "other", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, email: "not-an-email" }).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...base, email: "a@b.com" }).success, true);
});

test("lead_submit requires a real conversationId (uuid) when one IS provided — an anonymous/forged string is rejected before it ever reaches the database layer", () => {
  const base = { type: "lead_submit", locale: "fr", fullName: "A", email: "a@b.com", requestType: "other", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, conversationId: "not-a-uuid" }).success, false);
});

test("lead_submit's conversationId is optional — the calendar-button entry point can open the form before any message/conversation exists", () => {
  const base = { type: "lead_submit", locale: "fr", fullName: "A", email: "a@b.com", requestType: "other", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse(base).success, true);
});

test("lead_submit requires requestType to be one of the closed set — an unknown/free-text value is rejected", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", email: "a@b.com", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, requestType: "call_me_now" }).success, false);
  assert.equal(chatRequestSchema.safeParse(base).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...base, requestType: "meeting" }).success, true);
});

test("lead_submit accepts optional preferredDate/preferredTimeSlot as a declared preference, never a booking", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", email: "a@b.com", requestType: "meeting", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, preferredDate: "2026-09-01", preferredTimeSlot: "après-midi" }).success, true);
  assert.equal(chatRequestSchema.safeParse(base).success, true);
});

test("escalate requires only conversationId + locale", () => {
  const result = chatRequestSchema.safeParse({ type: "escalate", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "en" });
  assert.equal(result.success, true);
});

// §Phase 1F — phone is optional (never required, unlike email/fullName):
// an omitted or empty phone must never block submission.
test("lead_submit accepts a missing phone", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", email: "a@b.com", requestType: "other", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse(base).success, true);
});

test("lead_submit accepts an empty-string phone the same as a missing one", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", email: "a@b.com", requestType: "other", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, phone: "" }).success, true);
});

test("lead_submit accepts a valid E.164 phone number", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", email: "a@b.com", requestType: "other", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, phone: "+33612345678" }).success, true);
  assert.equal(chatRequestSchema.safeParse({ ...base, phone: "+23057123456" }).success, true);
  assert.equal(chatRequestSchema.safeParse({ ...base, phone: "+237612345678" }).success, true);
  assert.equal(chatRequestSchema.safeParse({ ...base, phone: "+14165551234" }).success, true);
});

test("lead_submit rejects a phone that is present but not a valid number, since only an EMPTY phone is exempt from validation", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", email: "a@b.com", requestType: "other", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, phone: "123" }).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...base, phone: "not a phone number" }).success, false);
});
