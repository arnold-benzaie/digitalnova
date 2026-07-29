// Tests for the Stage 8 (Make sub-stage) generated action scenarios under
// templates/make/**. No DB, no server needed — reads the generated files
// plus lib/api-v1/openapi.yaml straight off disk, mirroring
// generate-n8n-templates.test.mjs's approach and rationale (no real Make
// instance exists in this environment to literally import into — see
// that file's docstring, and templates/make/README.md, for why this
// generator deliberately uses only ONE well-documented Make module type).
//
// Run with: npx tsx --test scripts/generate-make-scenarios.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractOperations, loadOpenApiDoc } from "./lib/openapi-operations.mjs";

const SCENARIOS_DIR = join("templates", "make");

const { doc } = loadOpenApiDoc();
const realOperations = extractOperations(doc);
const realOperationIds = new Set(realOperations.map((op) => op.operationId));
const API_BASE_URL = doc.servers[0].url;

function loadScenarioFiles() {
  return readdirSync(SCENARIOS_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function loadScenario(fileName) {
  return JSON.parse(readFileSync(join(SCENARIOS_DIR, fileName), "utf8"));
}

test("exactly one scenario exists per real /api/v1 operation — no missing, no stale, no orphan file", () => {
  const files = loadScenarioFiles();
  const fileOperationIds = new Set(files.map((f) => f.replace(/\.json$/, "")));

  assert.deepEqual(fileOperationIds, realOperationIds);
  assert.equal(files.length, realOperations.length);
});

for (const op of extractOperations(loadOpenApiDoc().doc)) {
  test(`${op.operationId}.json: valid Make blueprint shape, matches the real ${op.method} ${op.path} operation`, () => {
    const scenario = loadScenario(`${op.operationId}.json`);

    // Top-level blueprint shape a real Make import requires.
    assert.equal(typeof scenario.name, "string");
    assert.ok(scenario.name.startsWith("PUBLIC-MAP — "), "scenario name must be clearly PUBLIC-MAP-branded");
    assert.ok(Array.isArray(scenario.flow));
    assert.equal(scenario.flow.length, 1, "every action scenario is a single HTTP module — see the README for why Make needs no separate trigger module");
    assert.equal(typeof scenario.metadata, "object");
    assert.equal(scenario.metadata.instant, false, "no instant/webhook-triggered scenario is generated");

    const [module_] = scenario.flow;

    // The hard constraint from this sub-stage: only the one, well-
    // documented generic HTTP action module — never an invented,
    // unverifiable module type, and never anything trigger/webhook-shaped.
    assert.equal(module_.id, 1);
    assert.equal(module_.module, "http:ActionSendData");
    assert.doesNotMatch(module_.module.toLowerCase(), /webhook|trigger|instant/, "no trigger/webhook module type is present");
    assert.equal(typeof module_.version, "number");
    assert.equal(typeof module_.mapper, "object");

    // Method/URL parity with the real, current API surface.
    assert.equal(module_.mapper.method, op.method.toLowerCase());
    const expectedPath = op.path.replace(/\{(\w+)\}/g, (_m, name) => `YOUR_${name.toUpperCase()}`);
    assert.equal(module_.mapper.url, `${API_BASE_URL}${expectedPath}`);

    // Auth header: a clearly-named literal placeholder — never a
    // real-shaped API key baked into the file.
    const authHeader = module_.mapper.headers.find((h) => h.name === "Authorization");
    assert.ok(authHeader);
    assert.equal(authHeader.value, "Bearer YOUR_PUBLIC_MAP_API_KEY");
    assert.doesNotMatch(JSON.stringify(scenario), /pm_(live|test)_/, "no real-shaped API key must ever appear in a generated scenario");

    if (op.requestBodySchema) {
      assert.equal(module_.mapper.bodyType, "raw");
      assert.equal(module_.mapper.contentType, "application/json");
      const body = JSON.parse(module_.mapper.data);
      for (const requiredField of op.requestBodySchema.required ?? []) {
        assert.ok(Object.hasOwn(body, requiredField), `${op.operationId}: example body missing required field "${requiredField}"`);
      }
      if (op.method === "POST") {
        const idempotencyHeader = module_.mapper.headers.find((h) => h.name === "Idempotency-Key");
        assert.ok(idempotencyHeader, `${op.operationId}: a real write route supports Idempotency-Key — the scenario should demonstrate it`);
      }
    } else {
      assert.equal(module_.mapper.bodyType, "empty");
      assert.equal(module_.mapper.data, undefined);
      assert.equal(module_.mapper.contentType, undefined);
    }
  });
}
