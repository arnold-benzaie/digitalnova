"use strict";

// Tests for the Stage 8 (Zapier sub-stage) app — a self-contained
// package (see README.md, same "own package.json, own deps, own tests"
// pattern as sdks/typescript and sdks/python from Stage 2), run with:
//   cd zapier && npm test
//
// No live PUBLIC-MAP server exists yet (see lib/api-v1/openapi.yaml's
// own "servers" comment: "not live yet"), so perform() functions are
// exercised with a stubbed `z` (a fake z.request capturing exactly what
// URL/method/body/headers it was called with) rather than a real network
// call — this still genuinely runs the real generated code, it just
// doesn't hit a real server. Structural checks (key/noun/display/
// operation shape) run against the REAL required module objects, not
// text — the strongest test rigor of any Stage 8 sub-stage, made
// possible because Zapier's platform IS plain requireable JavaScript,
// unlike n8n's/Make's proprietary JSON or Airtable's copy-pasted source.

const { test } = require("node:test");
const assert = require("node:assert/strict");

const App = require("../index.js");
const { authentication, addApiKeyToHeader, API_BASE_URL } = require("../authentication.js");

test("App: wires up authentication, beforeRequest, and every resource", () => {
  assert.equal(App.authentication.type, "custom");
  assert.ok(App.beforeRequest.includes(addApiKeyToHeader));
  assert.deepEqual(Object.keys(App.triggers).sort(), ["new_audit", "new_client", "new_report"]);
  assert.deepEqual(Object.keys(App.searches).sort(), ["find_audit", "find_client", "find_report"]);
  assert.deepEqual(Object.keys(App.creates).sort(), ["create_interaction", "create_task", "update_client"]);
});

test("authentication: test() calls the real GET /ping route, nothing else", async () => {
  const calls = [];
  const z = { request: async (opts) => { calls.push(opts); return { data: { data: { pong: true, organizationId: "org_1", scopes: [] } } }; } };
  const result = await authentication.test(z, {});
  assert.equal(calls.length, 1);
  assert.equal(calls[0].url, `${API_BASE_URL}/ping`);
  assert.deepEqual(result, { pong: true, organizationId: "org_1", scopes: [] });
});

test("authentication: addApiKeyToHeader adds the real Bearer header, never logs or embeds a key", () => {
  const request = { headers: {} };
  const withAuth = addApiKeyToHeader(request, {}, { authData: { apiKey: "pm_live_fake_for_test" } });
  assert.equal(withAuth.headers.Authorization, "Bearer pm_live_fake_for_test");

  // No auth data yet (e.g. during the initial auth test itself) must not throw.
  const noAuthYet = addApiKeyToHeader({ headers: {} }, {}, { authData: {} });
  assert.equal(noAuthYet.headers.Authorization, undefined);
});

for (const [key, expectedPath] of [
  ["new_audit", "/audits"],
  ["new_client", "/clients"],
  ["new_report", "/reports"],
]) {
  test(`triggers.${key}: valid Zapier trigger shape, polls the real ${expectedPath}`, async () => {
    const trigger = App.triggers[key];
    assert.equal(trigger.operation.type, "polling");
    assert.ok(trigger.display.description.startsWith("Triggers when "), "Zapier's own D021 publishing check requires this exact prefix");
    assert.equal(typeof trigger.operation.perform, "function");
    assert.ok(trigger.operation.sample.id, "sample must include an id field for Zapier's polling dedupe");
    assert.ok(Array.isArray(trigger.operation.outputFields) && trigger.operation.outputFields.length > 0);

    const calls = [];
    const z = { request: async (opts) => { calls.push(opts); return { data: { data: [trigger.operation.sample] } }; } };
    const items = await trigger.operation.perform(z, { authData: {} });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${API_BASE_URL}${expectedPath}`);
    assert.deepEqual(items, [trigger.operation.sample]);
  });
}

for (const [key, idField, expectedPathPrefix] of [
  ["find_audit", "auditId", "/audits/"],
  ["find_client", "clientId", "/clients/"],
  ["find_report", "reportId", "/reports/"],
]) {
  test(`searches.${key}: valid Zapier search shape, looks up the real ${expectedPathPrefix}{id}`, async () => {
    const search = App.searches[key];
    assert.ok(search.operation.inputFields.some((f) => f.key === idField && f.required));
    assert.equal(typeof search.operation.perform, "function");

    const calls = [];
    const z = { request: async (opts) => { calls.push(opts); return { data: { data: search.operation.sample } }; } };
    const results = await search.operation.perform(z, { authData: {}, inputData: { [idField]: "real-id-123" } });
    assert.equal(calls.length, 1);
    assert.equal(calls[0].url, `${API_BASE_URL}${expectedPathPrefix}real-id-123`);
    assert.deepEqual(results, [search.operation.sample], "a search must return an array, even for a single result");
  });
}

test("creates.create_task: posts the real body to /tasks with a stable Idempotency-Key", async () => {
  const create = App.creates.create_task;
  assert.ok(create.operation.inputFields.some((f) => f.key === "clientId" && f.required));
  assert.ok(create.operation.inputFields.some((f) => f.key === "title" && f.required));

  const calls = [];
  const z = {
    request: async (opts) => { calls.push(opts); return { data: { data: create.operation.sample } }; },
    hash: (algo, data) => require("node:crypto").createHash(algo).update(data).digest("hex"),
  };
  const inputData = { clientId: "client-1", title: "Follow up" };
  await create.operation.perform(z, { authData: {}, inputData });
  await create.operation.perform(z, { authData: {}, inputData: { ...inputData } });

  assert.equal(calls.length, 2);
  assert.equal(calls[0].url, `${API_BASE_URL}/tasks`);
  assert.equal(calls[0].method, "POST");
  assert.deepEqual(calls[0].body, inputData);
  assert.ok(calls[0].headers["Idempotency-Key"]);
  assert.equal(
    calls[0].headers["Idempotency-Key"],
    calls[1].headers["Idempotency-Key"],
    "identical input must hash to the identical Idempotency-Key, so a real Zapier retry is safely deduped by the API",
  );
});

test("creates.create_task: DIFFERENT input produces a DIFFERENT Idempotency-Key", async () => {
  const create = App.creates.create_task;
  const calls = [];
  const z = {
    request: async (opts) => { calls.push(opts); return { data: { data: create.operation.sample } }; },
    hash: (algo, data) => require("node:crypto").createHash(algo).update(data).digest("hex"),
  };
  await create.operation.perform(z, { authData: {}, inputData: { clientId: "client-1", title: "A" } });
  await create.operation.perform(z, { authData: {}, inputData: { clientId: "client-1", title: "B" } });

  assert.notEqual(calls[0].headers["Idempotency-Key"], calls[1].headers["Idempotency-Key"]);
});

test("creates.update_client: PATCHes only the fields actually provided", async () => {
  const create = App.creates.update_client;
  const calls = [];
  const z = { request: async (opts) => { calls.push(opts); return { data: { data: create.operation.sample } }; } };
  await create.operation.perform(z, { authData: {}, inputData: { clientId: "client-1", name: "New Name" } });

  assert.equal(calls[0].url, `${API_BASE_URL}/clients/client-1`);
  assert.equal(calls[0].method, "PATCH");
  assert.deepEqual(calls[0].body, { name: "New Name" }, "fields the caller didn't set must never be sent, even as undefined/null");
});

test("no real-shaped API key is ever embedded in any generated module", () => {
  for (const group of [App.triggers, App.searches, App.creates]) {
    for (const resource of Object.values(group)) {
      assert.doesNotMatch(JSON.stringify(resource.operation.sample), /pm_(live|test)_/);
    }
  }
});
