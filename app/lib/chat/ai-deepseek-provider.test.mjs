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
let createCallCount = 0;
// When non-empty, each call to create() shifts one raw content string off
// this queue instead of using nextResponse — lets tests script a specific
// sequence (e.g. "first call returns malformed JSON, second call — the
// provider's own retry — returns valid JSON") without changing the
// default single-response behavior every other test relies on.
/** @type {string[]} */
let rawContentQueue = [];

const fakeClient = {
  chat: {
    completions: {
      create: async (params) => {
        lastCreateCall = params;
        createCallCount += 1;
        if (rawContentQueue.length > 0) {
          return { choices: [{ message: { content: rawContentQueue.shift() } }] };
        }
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

test("disables DeepSeek's default thinking mode on every request (not needed for a concise structured reply, documented gap with json_object mode)", async () => {
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Salut");
  assert.deepEqual(lastCreateCall.thinking, { type: "disabled" });
});

// ── Robust parsing pipeline (Preview 502 bug fix) ──────────────────────

test("valid JSON on the first attempt: parses directly, no retry call made", async () => {
  createCallCount = 0;
  rawContentQueue = [];
  nextResponse = { message: "Bonjour, comment puis-je vous aider ?", language: "fr", intent: "greeting", suggestions: [], action: { type: "none" } };
  const result = await ask("Salut");
  assert.equal(result.reply, "Bonjour, comment puis-je vous aider ?");
  assert.equal(createCallCount, 1, "a well-formed first response must not trigger the retry");
});

test("JSON wrapped in a ```json markdown fence is stripped and parsed successfully", async () => {
  createCallCount = 0;
  rawContentQueue = [
    "```json\n" + JSON.stringify({ message: "Bonjour !", language: "fr", intent: "greeting", suggestions: [], action: { type: "none" } }) + "\n```",
  ];
  const result = await ask("Salut");
  assert.equal(result.reply, "Bonjour !");
  assert.equal(createCallCount, 1);
});

test("a bare ``` fence (no 'json' language tag) is also stripped", async () => {
  createCallCount = 0;
  rawContentQueue = [
    "```\n" + JSON.stringify({ message: "Bonjour !", language: "fr", intent: "greeting", suggestions: [], action: { type: "none" } }) + "\n```",
  ];
  const result = await ask("Salut");
  assert.equal(result.reply, "Bonjour !");
  assert.equal(createCallCount, 1);
});

test("truncated/malformed JSON on the first attempt (e.g. an embedded raw newline breaking the string) triggers exactly one retry, which succeeds", async () => {
  createCallCount = 0;
  rawContentQueue = [
    '{"message": "Bonjour,\nje suis ravi', // unterminated string with a literal newline, mirrors the real bug
    JSON.stringify({ message: "Bonjour, je suis ravi de vous aider.", language: "fr", intent: "greeting", suggestions: [], action: { type: "none" } }),
  ];
  const result = await ask("Salut");
  assert.equal(result.reply, "Bonjour, je suis ravi de vous aider.");
  assert.equal(createCallCount, 2, "must retry exactly once after an invalid first response");
});

test("syntactically valid JSON that fails Zod validation on the first attempt also triggers one retry, which succeeds", async () => {
  createCallCount = 0;
  rawContentQueue = [
    JSON.stringify({ message: "x", language: "fr", intent: "x", suggestions: [], action: { type: "some_invented_action" } }),
    JSON.stringify({ message: "Réponse valide.", language: "fr", intent: "x", suggestions: [], action: { type: "none" } }),
  ];
  const result = await ask("Salut");
  assert.equal(result.reply, "Réponse valide.");
  assert.equal(createCallCount, 2);
});

test("two invalid responses in a row (both malformed): a single sanitized error is thrown after exactly one retry, never the raw content", async () => {
  createCallCount = 0;
  const secretLookingContent = '{"message": "Bonjour,\nDEEPSEEK_API_KEY=sk-should-never-leak';
  rawContentQueue = [secretLookingContent, secretLookingContent];
  await assert.rejects(() => ask("Salut"), (err) => {
    assert.match(err.message, /ai-deepseek-provider: (invalid_json|schema_validation_failed)/);
    assert.doesNotMatch(err.message, /DEEPSEEK_API_KEY|sk-should-never-leak|Bonjour/);
    return true;
  });
  assert.equal(createCallCount, 2, "must stop after exactly one retry, never loop");
});

test("no secret ever appears in a thrown error's message across the whole suite's failure paths", async () => {
  createCallCount = 0;
  rawContentQueue = ["not json at all {{{", "still not json {{{"];
  await assert.rejects(() => ask("Salut"), (err) => {
    assert.doesNotMatch(err.message, /sk-|api[_-]?key/i);
    return true;
  });
});

// ── Language consistency (Phase 2.1) ────────────────────────────────────

test("AiProviderOutput.language is the app-computed language, not necessarily the model's own self-reported field", async () => {
  createCallCount = 0;
  rawContentQueue = [];
  nextResponse = { message: "Bonjour !", language: "fr", intent: "greeting", suggestions: [], action: { type: "none" } };
  const result = await ask("Bonjour", { locale: "fr" });
  assert.equal(result.language, "fr");
});

test("a clear English message overrides an unrelated French interface locale for the resolved language", async () => {
  createCallCount = 0;
  rawContentQueue = [];
  nextResponse = { message: "Hello!", language: "en", intent: "greeting", suggestions: [], action: { type: "none" } };
  const result = await ask("Hi there", { locale: "fr" });
  assert.equal(result.language, "en");
  assert.match(lastCreateCall.messages[0].content, /write your entire reply.*in English only for this turn/is);
});

test("an ambiguous message with no clear signal falls back to the interface locale, not a guess", async () => {
  createCallCount = 0;
  rawContentQueue = [];
  nextResponse = { message: "...", language: "en", intent: "x", suggestions: [], action: { type: "none" } };
  const result = await ask("SEO", { locale: "en" });
  assert.equal(result.language, "en");
  assert.match(lastCreateCall.messages[0].content, /write your entire reply.*in English only for this turn/is);
});

test("the language directive is mandatory wording, present regardless of provider surface", async () => {
  createCallCount = 0;
  rawContentQueue = [];
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Bonjour", { locale: "fr" });
  assert.match(lastCreateCall.messages[0].content, /LANGUAGE \(MANDATORY\)/);
});

// ── Surface-based role (Phase 2.1, Objective 3) ─────────────────────────

test("surface:'site' gets a commercial/advisory-prospect role framing", async () => {
  createCallCount = 0;
  rawContentQueue = [];
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Bonjour", { surface: "site" });
  assert.match(lastCreateCall.messages[0].content, /marketing website/i);
  assert.match(lastCreateCall.messages[0].content, /commercial\/advisory guide/i);
});

test("surface:'app' keeps the existing dashboard-oriented role framing (no marketing-site language)", async () => {
  createCallCount = 0;
  rawContentQueue = [];
  nextResponse = { message: "ok", language: "fr", intent: "x", suggestions: [], action: { type: "none" } };
  await ask("Bonjour", { surface: "app" });
  assert.doesNotMatch(lastCreateCall.messages[0].content, /commercial\/advisory guide/i);
  assert.match(lastCreateCall.messages[0].content, /dashboard\/app surface|dashboard — act as their ongoing/i);
});
