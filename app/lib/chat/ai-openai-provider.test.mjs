// Unit tests for the Phase 2 real-LLM provider — a fake OpenAI client is
// injected via createOpenaiProvider(client) (see that file's header
// comment for why: mock.module("openai", …) silently failed to
// intercept the bare npm package under tsx, and the fake client design
// guarantees NO real network request to api.openai.com is ever made by
// this suite, even accidentally). What's actually under test is the
// PUBLIC-MAP-side contract: structured-output parsing, the suggestion-
// id allowlist filter, and — most importantly — that the model's own
// `action` claim can NEVER open the lead form on its own; it must agree
// with the independent, deterministic isExplicitLeadIntent() check.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/chat/ai-openai-provider.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { createOpenaiProvider } = await import("@/lib/chat/ai-openai-provider");

/** @type {{ message: string; language: "fr" | "en"; intent: string; suggestions: string[]; action: { type: "none" | "show_lead_form" } } | { throwEmpty?: boolean; throwNetwork?: boolean }} */
let nextResponse = { message: "ok", language: "fr", intent: "test", suggestions: [], action: { type: "none" } };
let lastCreateCall = null;

const fakeClient = {
  responses: {
    create: async (params) => {
      lastCreateCall = params;
      if (nextResponse.throwNetwork) throw new Error("simulated network failure");
      if (nextResponse.throwEmpty) return { output_text: "" };
      return { output_text: JSON.stringify(nextResponse) };
    },
  },
};

const provider = createOpenaiProvider(fakeClient);

const anonymousContext = { kind: "anonymous", visitorId: "abc", locale: "fr" };

function ask(userMessage, overrides = {}) {
  return provider.generateReply({
    locale: "fr",
    userMessage,
    history: [],
    context: { ...anonymousContext },
    surface: "site",
    ...overrides,
  });
}

test("throws a clear error when no client is injected and OPENAI_API_KEY is not configured (never a fake key)", async () => {
  const original = process.env.OPENAI_API_KEY;
  delete process.env.OPENAI_API_KEY;
  try {
    const uninjectedProvider = createOpenaiProvider();
    await assert.rejects(() => uninjectedProvider.generateReply({ locale: "fr", userMessage: "Salut", history: [], context: anonymousContext, surface: "site" }), /OPENAI_API_KEY is not configured/);
  } finally {
    if (original !== undefined) process.env.OPENAI_API_KEY = original;
  }
});

test("maps a well-formed structured response to AiProviderOutput", async () => {
  nextResponse = { message: "Bonjour !", language: "fr", intent: "greeting", suggestions: ["gbp", "seo"], action: { type: "none" } };
  const result = await ask("Salut");
  assert.equal(result.reply, "Bonjour !");
  assert.deepEqual(result.suggestions, [{ id: "gbp" }, { id: "seo" }]);
  assert.equal(result.action, undefined);
});

test("unknown/hallucinated suggestion ids are silently filtered out, never passed through", async () => {
  nextResponse = { message: "...", language: "fr", intent: "x", suggestions: ["gbp", "not_a_real_id", "seo"], action: { type: "none" } };
  const result = await ask("Bonjour");
  assert.deepEqual(result.suggestions, [{ id: "gbp" }, { id: "seo" }]);
});

test("suggestions are capped at 4 even if the model proposes more", async () => {
  nextResponse = { message: "...", language: "fr", intent: "x", suggestions: ["gbp", "seo", "google_ads", "website", "automation"], action: { type: "none" } };
  const result = await ask("Bonjour");
  assert.equal(result.suggestions.length, 4);
});

test("§9 — model proposes show_lead_form on an explicit request AND the backend keyword check agrees: the form opens", async () => {
  nextResponse = { message: "Bien sûr.", language: "fr", intent: "quote", suggestions: [], action: { type: "show_lead_form" } };
  const result = await ask("Je voudrais un devis");
  assert.deepEqual(result.action, { type: "show_lead_form" });
});

test("§9 — model HALLUCINATES show_lead_form on an ordinary message: the backend keyword check disagrees, so the form does NOT open", async () => {
  nextResponse = { message: "Le SEO local...", language: "fr", intent: "seo", suggestions: ["seo"], action: { type: "show_lead_form" } };
  const result = await ask("Parlez-moi du SEO");
  assert.equal(result.action, undefined, "a hallucinated action must never survive the backend gate on its own");
});

test("§9 — model proposes 'none' even though the message is explicit: the backend still won't open it (both must agree)", async () => {
  nextResponse = { message: "...", language: "fr", intent: "quote", suggestions: [], action: { type: "none" } };
  const result = await ask("Je voudrais un devis");
  assert.equal(result.action, undefined);
});

test("EN: 'I want a quote' + model agreeing also opens the form", async () => {
  nextResponse = { message: "Sure.", language: "en", intent: "quote", suggestions: [], action: { type: "show_lead_form" } };
  const result = await ask("I'd like a quote");
  assert.deepEqual(result.action, { type: "show_lead_form" });
});

test("empty output_text from the API throws (never silently returns a blank reply)", async () => {
  nextResponse = { throwEmpty: true };
  await assert.rejects(() => ask("Salut"), /empty output_text/);
});

test("a network/API failure propagates unmodified (caught by route.ts's existing catch, not swallowed here)", async () => {
  nextResponse = { throwNetwork: true };
  await assert.rejects(() => ask("Salut"), /simulated network failure/);
});

test("an out-of-enum action type from the model fails Zod validation rather than being trusted", async () => {
  nextResponse = { message: "x", language: "fr", intent: "x", suggestions: [], action: { type: "some_invented_action" } };
  await assert.rejects(() => ask("Salut"));
});

test("uses AI_MODEL from the environment, defaulting to gpt-5.4-mini when unset", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };

  delete process.env.AI_MODEL;
  await ask("Salut");
  assert.equal(lastCreateCall.model, "gpt-5.4-mini");

  process.env.AI_MODEL = "gpt-5.4-mini-2026-03-17";
  await ask("Salut");
  assert.equal(lastCreateCall.model, "gpt-5.4-mini-2026-03-17");
  delete process.env.AI_MODEL;
});

test("sends the full bounded history plus the current message, oldest-first, mapped to user/assistant roles", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  const history = [
    { senderType: "visitor", content: "J'ai un restaurant" },
    { senderType: "assistant", content: "Très bien..." },
  ];
  await ask("Je veux plus de clients", { history });
  assert.deepEqual(lastCreateCall.input, [
    { role: "user", content: "J'ai un restaurant" },
    { role: "assistant", content: "Très bien..." },
    { role: "user", content: "Je veux plus de clients" },
  ]);
});

test("requests Structured Outputs with strict:true and a bounded max_output_tokens", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Salut");
  assert.equal(lastCreateCall.text.format.type, "json_schema");
  assert.equal(lastCreateCall.text.format.strict, true);
  assert.ok(typeof lastCreateCall.max_output_tokens === "number" && lastCreateCall.max_output_tokens > 0 && lastCreateCall.max_output_tokens <= 2000);
});

test("system prompt (instructions) forbids revealing itself/secrets and states the anti-hallucination rule", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Salut");
  const instructions = lastCreateCall.instructions;
  assert.match(instructions, /confidential/i);
  assert.match(instructions, /never invent|NEVER INVENT/);
});

test("system prompt lists only known suggestion ids (no id outside the shared catalog)", async () => {
  const { SUGGESTION_IDS } = await import("@/lib/chat/suggestion-catalog");
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Salut");
  for (const id of SUGGESTION_IDS) {
    assert.ok(lastCreateCall.instructions.includes(id), `system prompt should mention "${id}"`);
  }
});

// ── Language consistency (Phase 2.1) ────────────────────────────────────

test("AiProviderOutput.language is the app-computed language, not necessarily the model's own self-reported field", async () => {
  nextResponse = { message: "Bonjour !", language: "fr", intent: "greeting", suggestions: [], action: { type: "none" } };
  const result = await ask("Bonjour", { locale: "fr" });
  assert.equal(result.language, "fr");
});

test("a clear English message overrides an unrelated French interface locale for the resolved language", async () => {
  nextResponse = { message: "Hello!", language: "en", intent: "greeting", suggestions: [], action: { type: "none" } };
  const result = await ask("Hi there", { locale: "fr" });
  assert.equal(result.language, "en");
  assert.match(lastCreateCall.instructions, /write your entire reply.*in English only for this turn/is);
});

test("an ambiguous message with no clear signal falls back to the interface locale, not a guess", async () => {
  nextResponse = { message: "...", language: "en", intent: "x", suggestions: [], action: { type: "none" } };
  const result = await ask("SEO", { locale: "en" });
  assert.equal(result.language, "en");
  assert.match(lastCreateCall.instructions, /write your entire reply.*in English only for this turn/is);
});

test("the language directive is mandatory wording, present regardless of provider surface", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Bonjour", { locale: "fr" });
  assert.match(lastCreateCall.instructions, /LANGUAGE \(MANDATORY\)/);
});

// ── Surface-based role (Phase 2.1, Objective 3) ─────────────────────────

test("surface:'site' gets a commercial/advisory-prospect role framing", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Bonjour", { surface: "site" });
  assert.match(lastCreateCall.instructions, /marketing website/i);
  assert.match(lastCreateCall.instructions, /commercial\/advisory guide/i);
});

test("surface:'app' keeps the existing dashboard-oriented role framing (no marketing-site language)", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Bonjour", { surface: "app" });
  assert.doesNotMatch(lastCreateCall.instructions, /commercial\/advisory guide/i);
  assert.match(lastCreateCall.instructions, /dashboard\/app surface|dashboard — act as their ongoing/i);
});
