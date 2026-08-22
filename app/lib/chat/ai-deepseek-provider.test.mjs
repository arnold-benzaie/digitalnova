// Unit tests for the DeepSeek provider — a fake Chat Completions client
// is injected via createDeepseekProvider(client), exactly the same
// dependency-injection pattern as ai-openai-provider.test.mjs (see that
// file's header comment for why mock.module("openai", …) was abandoned:
// it silently failed to intercept the bare npm package under tsx). No
// real request to api.deepseek.com is possible from this suite, and no
// DeepSeek API key is used or needed — DEEPSEEK_API_KEY is never set in
// this file at all.
//
// Run with: npx tsx --test --experimental-test-module-mocks lib/chat/ai-deepseek-provider.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

const { createDeepseekProvider } = await import("@/lib/chat/ai-deepseek-provider");

/** @type {{ message: string; language: "fr" | "en"; intent: string; suggestions: string[]; action: { type: "none" | "show_lead_form" } } | { throwEmpty?: boolean; throwNetwork?: boolean }} */
let nextResponse = { message: "ok", language: "fr", intent: "test", suggestions: [], action: { type: "none" } };
let lastCreateCall = null;

const fakeClient = {
  chat: {
    completions: {
      create: async (params) => {
        lastCreateCall = params;
        if (nextResponse.throwNetwork) throw new Error("simulated network failure");
        if (nextResponse.throwEmpty) return { choices: [{ message: { content: "" } }] };
        return { choices: [{ message: { content: JSON.stringify(nextResponse) } }] };
      },
    },
  },
};

const provider = createDeepseekProvider(fakeClient);

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

test("throws a clear error when no client is injected and DEEPSEEK_API_KEY is not configured (never a fake key)", async () => {
  const original = process.env.DEEPSEEK_API_KEY;
  delete process.env.DEEPSEEK_API_KEY;
  try {
    const uninjectedProvider = createDeepseekProvider();
    await assert.rejects(() => uninjectedProvider.generateReply({ locale: "fr", userMessage: "Salut", history: [], context: anonymousContext, surface: "site" }), /DEEPSEEK_API_KEY is not configured/);
  } finally {
    if (original !== undefined) process.env.DEEPSEEK_API_KEY = original;
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

test("EN: 'I want a quote' + model agreeing also opens the form", async () => {
  nextResponse = { message: "Sure.", language: "en", intent: "quote", suggestions: [], action: { type: "show_lead_form" } };
  const result = await ask("I'd like a quote");
  assert.deepEqual(result.action, { type: "show_lead_form" });
});

test("empty content from the API throws (DeepSeek's own docs note this can happen; never silently returns a blank reply)", async () => {
  nextResponse = { throwEmpty: true };
  await assert.rejects(() => ask("Salut"), /empty content/);
});

test("a network/API failure propagates unmodified (caught by route.ts's existing catch, not swallowed here)", async () => {
  nextResponse = { throwNetwork: true };
  await assert.rejects(() => ask("Salut"), /simulated network failure/);
});

test("an out-of-enum action type from the model fails Zod validation rather than being trusted (no strict json_schema mode on DeepSeek's side to rely on)", async () => {
  nextResponse = { message: "x", language: "fr", intent: "x", suggestions: [], action: { type: "some_invented_action" } };
  await assert.rejects(() => ask("Salut"));
});

test("uses AI_MODEL from the environment, defaulting to deepseek-v4-flash when unset", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };

  delete process.env.AI_MODEL;
  await ask("Salut");
  assert.equal(lastCreateCall.model, "deepseek-v4-flash");

  process.env.AI_MODEL = "deepseek-v4-flash-0731";
  await ask("Salut");
  assert.equal(lastCreateCall.model, "deepseek-v4-flash-0731");
  delete process.env.AI_MODEL;
});

test("sends the full bounded history plus the current message, oldest-first, mapped to user/assistant roles, with a leading system message", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  const history = [
    { senderType: "visitor", content: "J'ai un restaurant" },
    { senderType: "assistant", content: "Très bien..." },
  ];
  await ask("Je veux plus de clients", { history });
  assert.equal(lastCreateCall.messages[0].role, "system");
  assert.deepEqual(lastCreateCall.messages.slice(1), [
    { role: "user", content: "J'ai un restaurant" },
    { role: "assistant", content: "Très bien..." },
    { role: "user", content: "Je veux plus de clients" },
  ]);
});

test("uses response_format:{type:'json_object'} (DeepSeek's documented JSON mode — no strict json_schema) and a bounded max_tokens", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Salut");
  assert.deepEqual(lastCreateCall.response_format, { type: "json_object" });
  assert.ok(typeof lastCreateCall.max_tokens === "number" && lastCreateCall.max_tokens > 0 && lastCreateCall.max_tokens <= 2000);
});

test("system message includes the word 'json' and a concrete example shape, per DeepSeek's own JSON-mode requirement", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Salut");
  const system = lastCreateCall.messages[0].content;
  assert.match(system, /json/);
  assert.match(system, /"message":/);
});

test("shares the same PUBLIC-MAP system prompt as the OpenAI provider (confidentiality + anti-hallucination clauses present)", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Salut");
  const system = lastCreateCall.messages[0].content;
  assert.match(system, /confidential/i);
  assert.match(system, /never invent|NEVER INVENT/);
});
