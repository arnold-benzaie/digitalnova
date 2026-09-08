// components/crm/create-follow-up-form.test.mjs — PHASE RADAR-CORE-3G.
//
// Structural checks for the explicit "add follow-up" form. Same approach as
// components/crm/follow-up-actions.test.mjs / radar-follow-up-quick-actions.test.mjs
// (this repo has no act()-capable React harness): assert the rendered
// static markup + the source text, never behaviour.
//
// The server action createFollowUp() owns every real guarantee (Class-A
// row, self-owned, OWNER rejected, validation) — covered by the frozen 3A
// backend suite lib/actions/crm-tasks-auth.integration.test.mjs. This file
// only proves the form is well-formed and accessible and delegates to that
// one action with no assignee/owner field of its own.
//
// NOT wired into package.json's `test` list — run with:
//   npx tsx --test --experimental-test-module-mocks components/crm/create-follow-up-form.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import React from "react";
import { renderToStaticMarkup } from "react-dom/server";

mock.module("next/navigation", {
  namedExports: { useRouter: () => ({ refresh: () => {} }) },
});
mock.module("@/lib/actions/crm-tasks", {
  namedExports: {
    // Never invoked by a static render; present so the value import resolves.
    createFollowUp: async () => undefined,
  },
});

const SOURCE = readFileSync(fileURLToPath(new URL("./create-follow-up-form.tsx", import.meta.url)), "utf8");
const { CreateFollowUpForm } = await import("./create-follow-up-form.tsx");

const html = (locale = "fr") =>
  renderToStaticMarkup(React.createElement(CreateFollowUpForm, { fixedClientId: "client-123", locale }));

function idOfLabelFor(markup, labelText) {
  // <label for="X" ...>labelText</label>
  const re = new RegExp(`<label[^>]*\\bfor="([^"]+)"[^>]*>${labelText}`);
  const m = markup.match(re);
  return m ? m[1] : null;
}

test("3G-form-1. imports ONLY createFollowUp from crm-tasks (no createTask, no assign verbs)", () => {
  assert.match(SOURCE, /import \{ createFollowUp \} from "@\/lib\/actions\/crm-tasks"/);
  assert.ok(!/createTask|assignFollowUp|claimFollowUp|updateTask/.test(SOURCE), "no other task action is imported");
});

test("3G-form-2. renders a hidden clientId input carrying fixedClientId", () => {
  const markup = html();
  assert.match(markup, /<input[^>]*type="hidden"[^>]*name="clientId"[^>]*value="client-123"/);
});

test("3G-form-3. subject field: named `title`, required, with an associated <label>", () => {
  const markup = html();
  const labelId = idOfLabelFor(markup, "Objet du suivi \\*");
  assert.ok(labelId, "a <label> whose text is the subject placeholder must exist");
  const inputRe = new RegExp(`<input[^>]*\\bid="${labelId}"[^>]*>`);
  const input = markup.match(inputRe)?.[0] ?? "";
  assert.ok(input, "an <input> whose id matches the subject label's for= must exist");
  assert.match(input, /\bname="title"/);
  assert.match(input, /\brequired\b|required=""/);
});

test("3G-form-4. due-date field: type=date, named `dueDate`, required, with an associated <label>", () => {
  const markup = html();
  const labelId = idOfLabelFor(markup, "Date de suivi");
  assert.ok(labelId, "a <label> whose text is the due-date label must exist");
  const inputRe = new RegExp(`<input[^>]*\\bid="${labelId}"[^>]*>`);
  const input = markup.match(inputRe)?.[0] ?? "";
  assert.ok(input, "an <input> whose id matches the due-date label's for= must exist");
  assert.match(input, /\btype="date"/);
  assert.match(input, /\bname="dueDate"/);
  assert.match(input, /\brequired\b|required=""/);
});

test("3G-form-5. a real text submit button (never icon-only), with the localized label", () => {
  const frMarkup = html("fr");
  assert.match(frMarkup, /<button[^>]*type="submit"[^>]*>Créer le suivi<\/button>/);
  const enMarkup = html("en");
  assert.match(enMarkup, /<button[^>]*type="submit"[^>]*>Create follow-up<\/button>/);
});

test("3G-form-6. NO assignee / owner / status field — the follow-up is self-owned by the server", () => {
  const markup = html();
  assert.ok(!markup.includes("<select"), "no <select> of any kind");
  assert.ok(!/name="(assignee|assignedUserId|createdByUserId|actorUserId|status|role)"/.test(markup));
  // The only form controls are the hidden clientId, the two visible inputs, and the submit button.
  const inputCount = (markup.match(/<input\b/g) ?? []).length;
  assert.equal(inputCount, 3, "exactly hidden clientId + subject + dueDate");
});

test("3G-form-7. EN locale renders EN copy for both labels", () => {
  const markup = html("en");
  assert.ok(idOfLabelFor(markup, "Follow-up subject \\*"), "EN subject label");
  assert.ok(idOfLabelFor(markup, "Follow-up date"), "EN due-date label");
});
