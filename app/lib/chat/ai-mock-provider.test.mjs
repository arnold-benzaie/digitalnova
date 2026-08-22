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

test("Unknown/unhandled question never invents information, lists what PUBLIC-MAP helps with, and never auto-opens the lead form (Phase 1D)", async () => {
  const result = await ask("fr", "Quel est le sens de la vie ?");
  assert.match(result.reply, /Google Business Profile, Google Ads, SEO/);
  assert.equal(result.action, undefined);
});

test("EN unknown fallback uses the English helpful message, never auto-opens the lead form", async () => {
  const result = await ask("en", "asdkjhasdkjh nonsense query");
  assert.match(result.reply, /Google Business Profile, Google Ads, SEO/);
  assert.equal(result.action, undefined);
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

// ---- Phase 1D: free-text conversational fix -------------------------------

test("Rule 1 — bare greetings (FR/EN) get a welcome reply, main suggestions, and NEVER the lead form", async () => {
  for (const [locale, message, needle] of [
    ["fr", "Salut", "Bonjour"],
    ["fr", "Bonjour", "Bonjour"],
    ["fr", "Bonsoir", "Bonjour"],
    ["fr", "Coucou", "Bonjour"],
    ["en", "Hi", "Hi! Welcome"],
    ["en", "Hello", "Hi! Welcome"],
    ["en", "Hey", "Hi! Welcome"],
    ["en", "Good morning", "Hi! Welcome"],
  ]) {
    const result = await ask(locale, message, "site");
    assert.match(result.reply, new RegExp(needle), `${locale}:${message}`);
    assert.equal(result.action, undefined, `${locale}:${message} must not open the lead form`);
    assert.deepEqual(ids(result), ["gbp", "google_ads", "seo", "website", "automation", "quote"], `${locale}:${message}`);
  }
});

test("Rule 1 — a greeting combined with a real request is NOT swallowed by the greeting branch", async () => {
  const result = await ask("fr", "Bonjour, je voudrais un devis", "site");
  assert.deepEqual(result.action, { type: "show_lead_form" });
});

test("Rule 2 — free-text phrases route to the right intent without matching chip wording exactly", async () => {
  const cases = [
    ["fr", "Je veux plus de clients", /générer plus de prospects/],
    ["fr", "Je voudrais apparaître sur Google Maps", /Google Business/],
    ["fr", "Je veux créer un site", /créer ou refaire votre site|créer ou améliorer votre site/],
    ["fr", "Je veux automatiser mon entreprise", /automatiser.*tâches|automatiser en premier/],
    ["fr", "Mes pubs Google ne marchent pas", /Google Ads/],
    ["fr", "Je veux améliorer mon SEO", /référencement/],
    ["en", "I need more customers", /generate more leads/],
    ["en", "I want to improve my Google Maps presence", /Google Business/],
    ["en", "I need a website", /build or redesign|create or improve/],
    ["en", "I want to automate my business", /automate/],
    ["en", "I need help with Google Ads", /Google Ads/],
  ];
  for (const [locale, message, pattern] of cases) {
    const result = await ask(locale, message, "site");
    assert.match(result.reply, pattern, `${locale}: "${message}"`);
  }
});

test("Rule 2/3 — 'Combien ça coûte ?' gives a pricing explanation WITHOUT opening the lead form", async () => {
  const fr = await ask("fr", "Combien ça coûte ?", "site");
  assert.match(fr.reply, /Nos tarifs dépendent/);
  assert.equal(fr.action, undefined);
  assert.deepEqual(ids(fr), ["quote", "human"]);

  const en = await ask("en", "How much does it cost?", "site");
  assert.match(en.reply, /Our pricing depends/);
  assert.equal(en.action, undefined);
});

test("Rule 3 — the lead form opens only for explicit devis/rappel/contact/human intent", async () => {
  const explicit = [
    ["fr", "Je veux un devis"],
    ["fr", "Rappelez-moi"],
    ["fr", "Je veux parler à quelqu'un"],
    ["fr", "Je veux être contacté"],
    ["en", "I want to talk to someone"],
    ["en", "Call me back"],
  ];
  for (const [locale, message] of explicit) {
    const result = await ask(locale, message, "site");
    assert.deepEqual(result.action, { type: "show_lead_form" }, `${locale}: "${message}"`);
  }

  const notExplicit = [
    ["fr", "Salut"],
    ["fr", "Bonjour"],
    ["fr", "Je veux créer un site"],
    ["fr", "Combien ça coûte ?"],
    ["en", "Hi"],
    ["en", "I need a website"],
  ];
  for (const [locale, message] of notExplicit) {
    const result = await ask(locale, message, "site");
    assert.equal(result.action, undefined, `${locale}: "${message}" must NOT open the lead form`);
  }
});

test("Rule 4 — the generic fallback lists what PUBLIC-MAP helps with, never claims uncertainty, and offers 'human' only as an ordinary chip", async () => {
  const result = await ask("fr", "Quel est le sens de la vie ?", "site");
  assert.match(result.reply, /Dites-moi simplement ce que vous souhaitez améliorer/);
  assert.equal(result.action, undefined);
  assert.deepEqual(ids(result), ["gbp", "google_ads", "seo", "website", "automation", "quote", "human"]);
});
