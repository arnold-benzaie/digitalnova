import { test } from "node:test";
import assert from "node:assert/strict";
import { mockAiProvider } from "@/lib/chat/ai-mock-provider";

const anonymousContext = { kind: "anonymous", visitorId: "abc", locale: "fr" };

async function ask(locale, message, surface) {
  return mockAiProvider.generateReply({ locale, userMessage: message, history: [], context: { ...anonymousContext, locale }, surface });
}

function ids(result) {
  return (result.suggestions ?? []).map((s) => s.id);
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

// ---- Phase 1C: surface:"site" sub-flow catalog ---------------------------

test("surface:'site' GBP click returns the GBP sub-menu, not the flat 6-chip set", async () => {
  const result = await ask("fr", "📍 Optimiser mon Google Business Profile", "site");
  assert.deepEqual(ids(result), ["gbp_audit", "gbp_info", "seo_local", "gbp_reviews", "gbp_posts", "gbp_photos", "gbp_performance"]);
});

test("surface:'site' automation click returns the rich use-case reply and the automation sub-menu", async () => {
  const result = await ask("fr", "🤖 Automatiser mon entreprise avec l'IA", "site");
  assert.match(result.reply, /n8n/);
  assert.match(result.reply, /webhook/i);
  assert.deepEqual(ids(result), ["automation_leads", "automation_support", "automation_emails", "automation_whatsapp", "automation_crm", "automation_examples", "quote", "human"]);
});

test("surface:'site' 'Mettre en place des automatisations' (voir plus) reaches the same automation branch", async () => {
  const result = await ask("fr", "⚙️ Mettre en place des automatisations", "site");
  assert.match(result.reply, /automatiser en premier/);
});

test("without surface:'site', the same GBP message keeps the original Phase 1A/1B reply and suggestions (no regression for the in-app dashboard widget)", async () => {
  const result = await ask("fr", "Je veux améliorer mon Google Business Profile.");
  assert.match(result.reply, /Google Business/);
  assert.deepEqual(ids(result), ["google_ads", "how_it_works", "performance", "account_help", "human"]);
});

test("surface:'site' leaf click ('Automatiser mes leads') resolves to the specific leaf, not the broader automation branch", async () => {
  const result = await ask("fr", "Automatiser mes leads", "site");
  assert.match(result.reply, /qualifier et distribuer/);
  assert.deepEqual(ids(result), ["quote", "human"]);
});

test("surface:'site' 'Landing page' inside the website sub-menu resolves to the landing-page leaf, not the generic website branch", async () => {
  const result = await ask("fr", "Landing page", "site");
  assert.match(result.reply, /taux de conversion/);
});

test("surface:'site' EN 'Keyword research' is not shadowed by the generic 'search' leaf", async () => {
  const result = await ask("en", "Keyword research", "site");
  assert.match(result.reply, /relevant keywords/);
});

test("surface:'site' 'Obtenir un devis' and 'Parler à un expert' still trigger the existing lead-form action", async () => {
  const quote = await ask("fr", "🧾 Obtenir un devis", "site");
  const human = await ask("fr", "🎧 Parler à un expert", "site");
  assert.deepEqual(quote.action, { type: "show_lead_form" });
  assert.deepEqual(human.action, { type: "show_lead_form" });
});
