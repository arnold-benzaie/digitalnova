// Tests for the Stage 8 (n8n sub-stage) generated action templates under
// templates/n8n/**. No DB, no server needed — this reads the generated
// files plus lib/api-v1/openapi.yaml straight off disk. Regenerate first
// if the spec has changed and the templates haven't been rebuilt yet:
//   npx tsx scripts/generate-n8n-templates.mjs
//
// This cannot literally open n8n's GUI and click Import (no n8n instance
// exists in this environment) — instead it verifies every structural
// invariant a real n8n import depends on (unique node names, connections
// that reference real nodes, the exact node `type`/`typeVersion` n8n
// expects), AND cross-checks every template's method/path against the
// real, current /api/v1 operations extracted from the same OpenAPI spec
// the generator itself reads — so "does this match the real API" is
// verified against the actual spec, not asserted by hand.
//
// Run with: npx tsx --test scripts/generate-n8n-templates.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractOperations, loadOpenApiDoc } from "./lib/openapi-operations.mjs";

const TEMPLATES_DIR = join("templates", "n8n");

const { doc } = loadOpenApiDoc();
const realOperations = extractOperations(doc);
const realOperationIds = new Set(realOperations.map((op) => op.operationId));

function loadTemplateFiles() {
  return readdirSync(TEMPLATES_DIR)
    .filter((name) => name.endsWith(".json"))
    .sort();
}

function loadTemplate(fileName) {
  return JSON.parse(readFileSync(join(TEMPLATES_DIR, fileName), "utf8"));
}

test("exactly one template exists per real /api/v1 operation — no missing, no stale, no orphan file", () => {
  const templateFiles = loadTemplateFiles();
  const templateOperationIds = new Set(templateFiles.map((f) => f.replace(/\.json$/, "")));

  assert.deepEqual(templateOperationIds, realOperationIds);
  assert.equal(templateFiles.length, realOperations.length);
});

for (const op of extractOperations(loadOpenApiDoc().doc)) {
  test(`${op.operationId}.json: valid n8n workflow shape, matches the real ${op.method} ${op.path} operation`, () => {
    const workflow = loadTemplate(`${op.operationId}.json`);

    // Top-level workflow shape a real n8n import requires.
    assert.equal(typeof workflow.name, "string");
    assert.ok(workflow.name.startsWith("PUBLIC-MAP — "), "workflow name must be clearly PUBLIC-MAP-branded");
    assert.ok(Array.isArray(workflow.nodes));
    assert.equal(workflow.nodes.length, 2, "every action template is exactly Manual Trigger -> HTTP Request, nothing more");
    assert.equal(typeof workflow.connections, "object");
    assert.deepEqual(workflow.pinData, {});

    const [trigger, http] = workflow.nodes;

    // Node names must be unique (n8n requires this) and connections must
    // reference real node names, never a typo'd or stale one.
    assert.notEqual(trigger.name, http.name);
    assert.deepEqual(Object.keys(workflow.connections), [trigger.name]);
    assert.equal(workflow.connections[trigger.name].main[0][0].node, http.name);

    // Every node needs these fields for n8n to accept an import.
    for (const node of workflow.nodes) {
      assert.equal(typeof node.id, "string");
      assert.ok(node.id.length > 0);
      assert.equal(typeof node.name, "string");
      assert.equal(typeof node.type, "string");
      assert.equal(typeof node.typeVersion, "number");
      assert.ok(Array.isArray(node.position) && node.position.length === 2);
      assert.equal(typeof node.parameters, "object");
    }

    // The hard constraint from this sub-stage: a MANUAL trigger only —
    // never n8n-nodes-base.webhook or any other reactive/event trigger,
    // since the event catalog has no customer-facing event to react to.
    assert.equal(trigger.type, "n8n-nodes-base.manualTrigger");
    assert.equal(trigger.typeVersion, 1);
    for (const node of workflow.nodes) {
      if (node.type === "n8n-nodes-base.manualTrigger") continue;
      assert.doesNotMatch(node.type.toLowerCase(), /webhook|trigger/, `${node.name} (${node.type}) must not be a webhook/event trigger node`);
    }

    // The HTTP node itself: real method/path parity with the spec.
    assert.equal(http.type, "n8n-nodes-base.httpRequest");
    assert.equal(http.typeVersion, 4.2);
    assert.equal(http.parameters.method, op.method);
    assert.equal(http.parameters.authentication, "none");

    const expectedPath = op.path.replace(/\{(\w+)\}/g, (_m, name) => `YOUR_${name.toUpperCase()}`);
    assert.equal(http.parameters.url, `={{$env.PUBLIC_MAP_BASE_URL}}${expectedPath}`);

    // Auth header: reads the API key from n8n's own environment — never a
    // literal key value baked into the file.
    const authHeader = http.parameters.headerParameters.parameters.find((p) => p.name === "Authorization");
    assert.ok(authHeader);
    assert.equal(authHeader.value, "=Bearer {{$env.PUBLIC_MAP_API_KEY}}");
    assert.doesNotMatch(JSON.stringify(workflow), /pm_(live|test)_/, "no real-shaped API key must ever appear in a generated template");

    if (op.requestBodySchema) {
      assert.equal(http.parameters.sendBody, true);
      assert.equal(http.parameters.specifyBody, "json");
      const body = JSON.parse(http.parameters.jsonBody);
      // Every field the API actually requires must be present in the example body.
      for (const requiredField of op.requestBodySchema.required ?? []) {
        assert.ok(Object.hasOwn(body, requiredField), `${op.operationId}: example body missing required field "${requiredField}"`);
      }
      if (op.method === "POST") {
        const idempotencyHeader = http.parameters.headerParameters.parameters.find((p) => p.name === "Idempotency-Key");
        assert.ok(idempotencyHeader, `${op.operationId}: a real write route supports Idempotency-Key — the template should demonstrate it`);
      }
    } else {
      assert.equal(http.parameters.sendBody, undefined);
    }
  });
}
