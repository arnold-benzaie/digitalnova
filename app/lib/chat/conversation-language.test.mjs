import { test } from "node:test";
import assert from "node:assert/strict";
import { detectClearMessageLanguage, resolveConversationLanguage } from "@/lib/chat/conversation-language";

function userMsg(content) {
  return { senderType: "visitor", content };
}
function assistantMsg(content) {
  return { senderType: "assistant", content };
}

test("detectClearMessageLanguage: unambiguous French greetings/phrases", () => {
  assert.equal(detectClearMessageLanguage("Bonjour"), "fr");
  assert.equal(detectClearMessageLanguage("Salut, j'ai un restaurant"), "fr");
  assert.equal(detectClearMessageLanguage("Combien ça coûte ?"), "fr");
  assert.equal(detectClearMessageLanguage("Merci beaucoup"), "fr");
});

test("detectClearMessageLanguage: unambiguous English greetings/phrases", () => {
  assert.equal(detectClearMessageLanguage("Hi"), "en");
  assert.equal(detectClearMessageLanguage("Hello, I run a hotel"), "en");
  assert.equal(detectClearMessageLanguage("How much does it cost?"), "en");
  assert.equal(detectClearMessageLanguage("Thanks a lot"), "en");
});

test("detectClearMessageLanguage: explicit switch requests win", () => {
  assert.equal(detectClearMessageLanguage("Can we continue in English?"), "en");
  assert.equal(detectClearMessageLanguage("On peut continuer en français ?"), "fr");
});

test("detectClearMessageLanguage: ambiguous/ultra-short text returns null (no guessing)", () => {
  assert.equal(detectClearMessageLanguage("SEO"), null);
  assert.equal(detectClearMessageLanguage("Google Ads"), null);
  assert.equal(detectClearMessageLanguage(""), null);
  assert.equal(detectClearMessageLanguage("ok"), null);
});

test("resolveConversationLanguage: rule 1 — clear current-message language wins over interface locale", () => {
  const result = resolveConversationLanguage({ currentMessage: "Bonjour", interfaceLocale: "en", history: [] });
  assert.equal(result, "fr");
});

test("resolveConversationLanguage: rule 2 — ambiguous message falls back to interface locale", () => {
  const result = resolveConversationLanguage({ currentMessage: "SEO", interfaceLocale: "en", history: [] });
  assert.equal(result, "en");
});

test("resolveConversationLanguage: an ambiguous short word never flips an already-French conversation away from the interface locale", () => {
  const history = [userMsg("Bonjour"), assistantMsg("Bonjour ! Comment puis-je vous aider ?"), userMsg("J'ai un restaurant")];
  const result = resolveConversationLanguage({ currentMessage: "SEO", interfaceLocale: "fr", history });
  assert.equal(result, "fr");
});

test("resolveConversationLanguage: rule 3 — missing/invalid interface locale falls back to history", () => {
  const history = [userMsg("Hello"), assistantMsg("Hi! How can I help?")];
  const result = resolveConversationLanguage({ currentMessage: "ok", interfaceLocale: undefined, history });
  assert.equal(result, "en");
});

test("resolveConversationLanguage: rule 4 — no signal anywhere falls back to fr", () => {
  const result = resolveConversationLanguage({ currentMessage: "123", interfaceLocale: undefined, history: [] });
  assert.equal(result, "fr");
});

test("resolveConversationLanguage: a deliberate mid-conversation switch is followed even with an established interface locale", () => {
  const history = [userMsg("Bonjour"), assistantMsg("Bonjour !")];
  const result = resolveConversationLanguage({ currentMessage: "Can we continue in English?", interfaceLocale: "fr", history });
  assert.equal(result, "en");
});

test("resolveConversationLanguage: history scan ignores assistant messages and finds the last clear USER message", () => {
  const history = [userMsg("Hello"), assistantMsg("Bonjour ! (assistant drifted)")];
  const result = resolveConversationLanguage({ currentMessage: "ok", interfaceLocale: undefined, history });
  assert.equal(result, "en");
});

// Regression: found via a real Preview live test — "Que me conseillez-vous ?"
// has no accented character and no verb from the old short phrase list,
// so it went undetected and incorrectly fell through to the interface
// locale instead of "fr".
test("detectClearMessageLanguage: unaccented French questions with common function words are still detected (regression)", () => {
  assert.equal(detectClearMessageLanguage("Que me conseillez-vous ?"), "fr");
  assert.equal(detectClearMessageLanguage("Que faites-vous ?"), "fr");
  assert.equal(detectClearMessageLanguage("Vous pouvez m'aider ?"), "fr");
});

test("detectClearMessageLanguage: everyday English questions are detected via common function words", () => {
  assert.equal(detectClearMessageLanguage("What would you recommend?"), "en");
  assert.equal(detectClearMessageLanguage("Can you help me with this?"), "en");
});

// Regression: found via a real Preview live test on the app dashboard
// widget — after an explicit FR->EN switch, "I'd like to talk to
// someone" matched no word in either list (no "the/is/you/want...", no
// "je/vous/voudrais..."), so it fell through to the interface locale.
// On the app surface that locale is the page's fixed, non-reactive
// value ("fr" in the test), silently pulling an established English
// conversation back to French — visible as a French lead-form title
// right after an English switch.
test("detectClearMessageLanguage: first-person English requests without a common function word are still detected (regression)", () => {
  assert.equal(detectClearMessageLanguage("I'd like to talk to someone"), "en");
  assert.equal(detectClearMessageLanguage("I'll take a look"), "en");
  assert.equal(detectClearMessageLanguage("I'm ready to start"), "en");
  assert.equal(detectClearMessageLanguage("I've decided to go ahead"), "en");
});

test("detectClearMessageLanguage: the French counterpart phrase is still detected", () => {
  assert.equal(detectClearMessageLanguage("Je voudrais parler à quelqu'un"), "fr");
});

test("resolveConversationLanguage: an established switch to English survives a message the interface locale alone would have reverted (regression)", () => {
  const history = [userMsg("Bonjour, j'ai un commerce local"), assistantMsg("..."), userMsg("Can we continue in English?"), assistantMsg("Sure!"), userMsg("What would you suggest?"), assistantMsg("...")];
  // interfaceLocale is still "fr" here — the app surface never changes
  // it mid-chat, exactly the real-world condition that exposed the bug.
  const result = resolveConversationLanguage({ currentMessage: "I'd like to talk to someone", interfaceLocale: "fr", history });
  assert.equal(result, "en");
});
