// Tests for the Stage 8 (Airtable sub-stage) generated action scripts
// under templates/airtable/**. No DB, no server, no real Airtable
// instance needed — reads the generated files plus lib/api-v1/openapi.yaml
// straight off disk, mirroring generate-n8n-templates.test.mjs and
// generate-make-scenarios.test.mjs's approach (see those files' own
// docstrings for why no live-platform import can be verified here).
//
// Unlike the n8n/Make tests, there is no structured JSON to inspect —
// the generated artifact IS JavaScript source, meant to be pasted into
// Airtable's own editor. This file therefore verifies: (1) every script
// is syntactically valid JavaScript (parsed, never executed — `new
// Function()` only compiles, so this is safe even though the source
// references `input`/`fetch`/`output`, none of which exist in this Node
// process), and (2) the generated source contains the real method/URL/
// required-body-fields for the matching /api/v1 operation, extracted
// from the same spec the generator itself reads.
//
// Run with: npx tsx --test scripts/generate-airtable-scripts.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { extractOperations, loadOpenApiDoc } from "./lib/openapi-operations.mjs";

const SCRIPTS_DIR = join("templates", "airtable");

/** Airtable's Scripting runtime executes a script's top level as an
 * implicit async function (top-level `await` works directly, no IIFE
 * needed) — matched here via the AsyncFunction constructor so
 * `await fetch(...)` at the top of a generated script is valid syntax to
 * check, exactly like it is in the real Airtable runtime. Still only
 * COMPILES, never invoked, so referencing input/fetch/output (undefined
 * in this Node process) is safe. */
const AsyncFunction = Object.getPrototypeOf(async function () {}).constructor;

const { doc } = loadOpenApiDoc();
const realOperations = extractOperations(doc);
const realOperationIds = new Set(realOperations.map((op) => op.operationId));
const API_BASE_URL = doc.servers[0].url;

function loadScriptFiles() {
  return readdirSync(SCRIPTS_DIR)
    .filter((name) => name.endsWith(".js"))
    .sort();
}

function loadScript(fileName) {
  return readFileSync(join(SCRIPTS_DIR, fileName), "utf8");
}

test("exactly one script exists per real /api/v1 operation — no missing, no stale, no orphan file", () => {
  const files = loadScriptFiles();
  const fileOperationIds = new Set(files.map((f) => f.replace(/\.js$/, "")));

  assert.deepEqual(fileOperationIds, realOperationIds);
  assert.equal(files.length, realOperations.length);
});

for (const op of extractOperations(loadOpenApiDoc().doc)) {
  test(`${op.operationId}.js: syntactically valid, matches the real ${op.method} ${op.path} operation`, () => {
    const source = loadScript(`${op.operationId}.js`);

    // Syntax check only — never invokes the compiled function.
    assert.doesNotThrow(() => new AsyncFunction(source), `${op.operationId}.js is not valid JavaScript`);

    // Real Airtable Scripting Automation primitives — this is the whole
    // point of these files, so their presence is asserted directly.
    assert.match(source, /input\.config\(\)/);
    assert.match(source, /output\.set\(/);
    assert.match(source, /await fetch\(/);

    // Never bake in a real key or read one from anywhere but the input
    // variable — this is the "no API key in generated files" constraint.
    assert.doesNotMatch(source, /pm_(live|test)_/, "no real-shaped API key must ever appear in a generated script");
    assert.match(source, /const apiKey = config\.apiKey;/);

    // Method/URL parity with the real, current API surface.
    assert.match(source, new RegExp(`method: "${op.method}"`));
    const expectedPathExpr = op.path.replace(/\{(\w+)\}/g, (_m, name) => "\\$\\{config\\." + name + "\\}");
    assert.match(source, new RegExp(`\\$\\{baseUrl\\}${expectedPathExpr.replace(/\//g, "\\/")}`));

    if (op.requestBodySchema) {
      assert.match(source, /body: JSON\.stringify\(/);
      for (const requiredField of op.requestBodySchema.required ?? []) {
        assert.match(source, new RegExp(`"${requiredField}":`), `${op.operationId}.js: example body missing required field "${requiredField}"`);
      }
      if (op.method === "POST") {
        assert.match(source, /Idempotency-Key/, `${op.operationId}.js: a real write route supports Idempotency-Key — the script should demonstrate it`);
      }
    } else {
      assert.doesNotMatch(source, /body: JSON\.stringify\(/);
    }

    // Base URL default matches the real spec's server URL.
    assert.match(source, new RegExp(`config\\.baseUrl \\|\\| "${API_BASE_URL.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}"`));
  });
}
