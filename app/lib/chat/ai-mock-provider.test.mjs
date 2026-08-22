import { test } from "node:test";
import assert from "node:assert/strict";
import { mockAiProvider } from "@/lib/chat/ai-mock-provider";

const anonymousContext = { kind: "anonymous", visitorId: "abc", locale: "fr" };

async function ask(locale, message) {
  return mockAiProvider.generateReply({ locale, userMessage: message, history: [], context: { ...anonymousContext, locale } });
}

test("FR: Google Business Profile question gets the GBP reply with suggestions", async () => {
  const result = await ask("fr", "Je veux améliorer mon Google Business Profile.");
  assert.match(result.reply, /Google Business/);
  assert.ok(result.suggestions.length > 0);
});

test("EN: Google Ads question gets the Ads reply", async () => {
  const result = await ask("en", "I want to launch Google Ads.");
  assert.match(result.reply, /Google Ads/);
});

test("FR: 'parler à quelqu'un' triggers show_lead_form action", async () => {
  const result = await ask("fr", "Je veux parler à quelqu'un.");
  assert.deepEqual(result.action, { type: "show_lead_form" });
});

test("EN: 'talk to someone' triggers show_lead_form action", async () => {
  const result = await ask("en", "I'd like to talk to someone.");
  assert.deepEqual(result.action, { type: "show_lead_form" });
});

test("Unknown/unhandled question never invents information — falls back to the uncertain-info message and offers the lead form", async () => {
  const result = await ask("fr", "Quel est le sens de la vie ?");
  assert.match(result.reply, /Je préfère ne pas vous donner une information incertaine/);
  assert.deepEqual(result.action, { type: "show_lead_form" });
});

test("EN unknown fallback uses the English uncertain-info message", async () => {
  const result = await ask("en", "asdkjhasdkjh nonsense query");
  assert.match(result.reply, /I'd rather not give you uncertain information/);
});

test("Suggestions are id-only — never carry a label (labels live in the i18n dictionary, not the provider)", async () => {
  const result = await ask("fr", "Comment fonctionne PUBLIC-MAP ?");
  for (const suggestion of result.suggestions ?? []) {
    assert.equal(typeof suggestion.id, "string");
    assert.equal("label" in suggestion, false);
  }
});

test("The error-simulation sentinel throws, for exercising the API route's error handling — never triggered by ordinary text", async () => {
  await assert.rejects(() => ask("fr", "TEST_SIMULATE_PROVIDER_ERROR"));
  await assert.rejects(() => ask("fr", "test_simulate_provider_error"));
  // Case-insensitive exact match only — a message that merely CONTAINS the
  // sentinel as a substring of otherwise-real text must not trigger it.
  const notTriggered = await ask("fr", "Please test_simulate_provider_error for me, thanks");
  assert.ok(notTriggered.reply);
});

test("SEO, website, and automation keywords each get their own distinct reply", async () => {
  const seo = await ask("fr", "Je veux améliorer mon référencement SEO.");
  const website = await ask("fr", "Je veux créer mon site web.");
  const automation = await ask("fr", "Je veux automatiser mon entreprise.");
  assert.notEqual(seo.reply, website.reply);
  assert.notEqual(website.reply, automation.reply);
});
