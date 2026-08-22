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
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", email: "a@b.com", message: "hi" };
  assert.equal(chatRequestSchema.safeParse({ ...base, consent: false }).success, false);
  assert.equal(chatRequestSchema.safeParse(base).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...base, consent: true }).success, true);
});

test("lead_submit requires a valid email", () => {
  const base = { type: "lead_submit", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "fr", fullName: "A", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, email: "not-an-email" }).success, false);
  assert.equal(chatRequestSchema.safeParse({ ...base, email: "a@b.com" }).success, true);
});

test("lead_submit requires a real conversationId (uuid) — an anonymous/forged string is rejected before it ever reaches the database layer", () => {
  const base = { type: "lead_submit", locale: "fr", fullName: "A", email: "a@b.com", message: "hi", consent: true };
  assert.equal(chatRequestSchema.safeParse({ ...base, conversationId: "not-a-uuid" }).success, false);
});

test("escalate requires only conversationId + locale", () => {
  const result = chatRequestSchema.safeParse({ type: "escalate", conversationId: "123e4567-e89b-42d3-a456-426614174000", locale: "en" });
  assert.equal(result.success, true);
});
