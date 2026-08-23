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

/**
 * Multi-turn helper: mirrors what app/api/chat/route.ts's handleMessage
 * actually does — append the visitor's message to `history`, call the
 * provider with that history, then append its reply — so each `.send()`
 * sees the real, growing conversation exactly like a live session would
 * (this is the ONLY "memory" the provider ever gets — see Phase 1E's
 * extractContext(), which re-derives context from this array each time).
 */
function conversation(locale) {
  const history = [];
  return {
    async send(message, surface = "site") {
      history.push({ senderType: "visitor", content: message });
      const result = await mockAiProvider.generateReply({ locale, userMessage: message, history: history.slice(0, -1), context: { ...anonymousContext, locale }, surface });
      history.push({ senderType: "assistant", content: result.reply });
      return result;
    },
  };
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

test("Unknown/unhandled question never invents information, asks what to improve, and never auto-opens the lead form (Phase 1E)", async () => {
  const result = await ask("fr", "Quel est le sens de la vie ?");
  assert.match(result.reply, /pas encore assez d'informations/);
  assert.equal(result.action, undefined);
});

test("EN unknown fallback uses the English helpful message, never auto-opens the lead form", async () => {
  const result = await ask("en", "asdkjhasdkjh nonsense query");
  assert.match(result.reply, /don't have enough context/);
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
  assert.deepEqual(ids(result), ["automation_leads", "automation_support", "automation_emails", "automation_whatsapp", "automation_crm", "automation_integrations", "automation_examples", "quote", "human"]);
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
    ["fr", "Je veux créer un site", /partez de zéro/],
    ["fr", "Je veux automatiser mon entreprise", /automatiser.*tâches|automatiser en premier/],
    ["fr", "Mes pubs Google ne marchent pas", /Google Ads/],
    ["fr", "Je veux améliorer mon SEO", /référencement/],
    ["en", "I need more customers", /generate more leads/],
    ["en", "I want to improve my Google Maps presence", /Google Business/],
    ["en", "I need a website", /starting from scratch/],
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

test("Rule 4 — the generic fallback never claims uncertainty, asks what to improve, and offers 'human' only as an ordinary chip (Phase 1E copy)", async () => {
  const result = await ask("fr", "Quel est le sens de la vie ?", "site");
  assert.match(result.reply, /pas encore assez d'informations/);
  assert.equal(result.action, undefined);
  assert.deepEqual(ids(result), ["browse_services", "human"]);
});

// ---- Phase 1E: conversational context ------------------------------------

test("naming a business type with no goal yet asks ONE qualifying question, no suggestions, no lead form", async () => {
  const restaurant = await ask("fr", "J'ai un restaurant.", "site");
  assert.match(restaurant.reply, /Votre priorité est plutôt/);
  assert.deepEqual(ids(restaurant), []);
  assert.equal(restaurant.action, undefined);

  const hotel = await ask("fr", "J'ai un hôtel.", "site");
  assert.match(hotel.reply, /plus de réservations ou une meilleure visibilité/);
  assert.deepEqual(ids(hotel), []);
});

test("all 8 business types have a distinct qualifying question (FR and EN)", async () => {
  const cases = [
    ["J'ai un restaurant.", "I run a restaurant."],
    ["J'ai un hôtel.", "I run a hotel."],
    ["J'ai un cabinet médical.", "I run a medical practice."],
    ["J'ai un cabinet d'avocat.", "I run a law firm."],
    ["J'ai une boutique.", "I run a shop."],
    ["J'ai une boutique en ligne.", "I run an online store."],
    ["J'ai une agence.", "I run an agency."],
    ["J'ai un commerce local.", "I run a local business."],
  ];
  const seen = new Set();
  for (const [fr, en] of cases) {
    const frResult = await ask("fr", fr, "site");
    const enResult = await ask("en", en, "site");
    assert.ok(frResult.reply.length > 0, fr);
    assert.ok(enResult.reply.length > 0, en);
    assert.equal(frResult.action, undefined, fr);
    seen.add(frResult.reply);
  }
  assert.equal(seen.size, cases.length, "every business type must get its own distinct question");
});

test("combining business type + goal in ONE message skips the qualifying question and goes straight to a contextual recommendation", async () => {
  const result = await ask("fr", "J'ai un hôtel et je veux plus de réservations.", "site");
  assert.match(result.reply, /Google Ads, Google Maps et votre système de réservation/);
  assert.ok(ids(result).length > 0);
});

test("EN: combining business type + goal in one message works the same way", async () => {
  const result = await ask("en", "I run a hotel and I need more bookings.", "site");
  assert.match(result.reply, /Google Ads, Google Maps and your booking system/);
});

test("restaurant/hotel contextual suggestions match the exact set from the request (GBP, reviews, Google Ads, booking)", async () => {
  const result = await ask("fr", "J'ai un restaurant et je veux plus de clients.", "site");
  assert.deepEqual(ids(result), ["gbp", "reviews", "google_ads", "website_booking"]);
});

test("website stays a two-turn flow even combined with a business type in one message; the type cards shrink once we know who's asking", async () => {
  const convo = conversation("fr");
  const first = await convo.send("J'ai une boutique et je veux créer un site.");
  // Website is deliberately never short-circuited into the generic
  // contextual-goal-response — §3 requires the new-vs-redesign question
  // regardless of what else is already known about the visitor.
  assert.match(first.reply, /partez de zéro/);
  assert.deepEqual(ids(first), []);

  const second = await convo.send("Nouveau, je pars de zéro.");
  assert.match(second.reply, /Quel type de site/);
  // Once the business type ("shop", non-hospitality) is known, the type
  // menu shrinks from the full 6-card catalog to the small, relevant set.
  assert.deepEqual(ids(second), ["website_showcase", "website_ecommerce", "website_booking", "website_landing"]);
});

test("automation contextual suggestions include the new n8n/webhooks card", async () => {
  // Reached only through the goal+businessType contextual branch.
  const result = await ask("fr", "J'ai une agence et je veux automatiser mon activité.", "site");
  assert.deepEqual(ids(result), ["automation_leads", "automation_emails", "automation_whatsapp", "automation_crm", "automation_integrations"]);
});

test("website topic is now a two-turn flow: new-vs-redesign first (no cards), then the 5 site types", async () => {
  const convo = conversation("fr");
  const first = await convo.send("Je veux créer un site.");
  assert.match(first.reply, /partez de zéro/);
  assert.deepEqual(ids(first), []);
  assert.equal(first.action, undefined);

  const second = await convo.send("Nouveau, je pars de zéro.");
  assert.match(second.reply, /Quel type de site/);
  assert.deepEqual(ids(second), ["website_showcase", "website_booking", "website_ecommerce", "website_landing", "website_custom", "quote"]);
});

test("website topic: answering 'refonte' after the new-vs-redesign question acknowledges the redesign", async () => {
  const convo = conversation("fr");
  await convo.send("Je veux créer un site.");
  const second = await convo.send("J'ai déjà un site, c'est une refonte.");
  assert.match(second.reply, /on va la refaire/);
});

test("EN: website two-turn flow", async () => {
  const convo = conversation("en");
  const first = await convo.send("I need a website.");
  assert.match(first.reply, /starting from scratch/);
  const second = await convo.send("New, starting from scratch.");
  assert.match(second.reply, /What type of website/);
});

test("Scenario A (FR): Salut -> restaurant -> more clients -> Google Ads (context kept) -> pricing (contextualized)", async () => {
  const convo = conversation("fr");

  const r1 = await convo.send("Salut");
  assert.match(r1.reply, /Ravi de vous accueillir/);

  const r2 = await convo.send("J'ai un restaurant");
  assert.match(r2.reply, /Votre priorité est plutôt/);
  assert.deepEqual(ids(r2), []);

  const r3 = await convo.send("Je veux plus de clients");
  assert.match(r3.reply, /Dans ce cas, je regarderais en priorité/);
  assert.deepEqual(ids(r3), ["gbp", "reviews", "google_ads", "website_booking"]);

  const r4 = await convo.send("Et Google Ads ?");
  assert.match(r4.reply, /Pour un restaurant, PUBLIC-MAP peut vous accompagner/);

  const r5 = await convo.send("Combien ça coûte ?");
  assert.match(r5.reply, /Pour un restaurant, nos tarifs dépendent/);
  assert.equal(r5.action, undefined);
});

test("Scenario B (FR): create a site -> new -> booking type -> quote opens the lead form", async () => {
  const convo = conversation("fr");

  const r1 = await convo.send("Je veux créer un site");
  assert.match(r1.reply, /partez de zéro/);

  const r2 = await convo.send("Nouveau");
  assert.match(r2.reply, /Quel type de site/);

  const r3 = await convo.send("Réservation");
  assert.match(r3.reply, /système de réservation en ligne/);

  const r4 = await convo.send("Je veux un devis");
  assert.deepEqual(r4.action, { type: "show_lead_form" });
});

test("Scenario C (EN): hotel -> more bookings -> AI automation (contextual) -> talk to someone opens the lead/human flow", async () => {
  const convo = conversation("en");

  const r1 = await convo.send("I run a hotel");
  assert.match(r1.reply, /more bookings or better visibility/);
  assert.deepEqual(ids(r1), []);

  const r2 = await convo.send("I need more bookings");
  assert.match(r2.reply, /Google Ads, Google Maps and your booking system/);

  // "automation" has its own dedicated topic branch (unlike more_bookings/
  // more_calls/etc.), so this reaches the rich automation reply — context-
  // prefixed. Suggestions stay the hospitality set: hotel/restaurant
  // always get that same short, high-signal set regardless of topic.
  const r3 = await convo.send("Can AI automation help?");
  assert.match(r3.reply, /^For a hotel, PUBLIC-MAP can automate many parts of your business/);
  assert.deepEqual(ids(r3), ["gbp", "reviews", "google_ads", "website_booking"]);

  const r4 = await convo.send("I want to speak to someone");
  assert.deepEqual(r4.action, { type: "show_lead_form" });
});

test("without surface:'site', context extraction never runs — the in-app dashboard widget is unaffected", async () => {
  const result = await ask("fr", "J'ai un restaurant.");
  // No surface:"site" -> falls straight through to the unchanged
  // Phase 1A fallback, never the new qualifying-question branch.
  assert.match(result.reply, /don't have enough context|pas encore assez d'informations/i);
});
