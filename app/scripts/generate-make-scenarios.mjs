#!/usr/bin/env node
/**
 * Generates Make (formerly Integromat) scenario blueprints under
 * templates/make/** from the same single source of truth as the n8n
 * templates and the Postman/Bruno/Insomnia collections —
 * lib/api-v1/openapi.yaml, via scripts/lib/openapi-operations.mjs (the
 * module all four generators share). See scripts/generate-n8n-
 * templates.mjs for the precedent this follows.
 *
 * Stage 8 (Make sub-stage) scope: ACTION scenarios only — same
 * constraint as n8n. No trigger/webhook module is generated: the event
 * catalog is still a single internal-only event (see the Stage 7 design
 * note at /developers/docs/event-catalog).
 *
 * Structural difference from the n8n generator, DELIBERATE, not an
 * oversight — see templates/make/README.md for the full explanation:
 *   - n8n needs an explicit Manual Trigger node before any action node;
 *     Make has no such requirement — any module can be the sole,
 *     first module of a scenario and still be run manually ("Run once")
 *     in the Make editor. Every generated scenario here is therefore a
 *     SINGLE http:ActionSendData module, not two.
 *   - n8n expressions can read OS-level environment variables
 *     ($env.VAR_NAME) directly in any field. Make's mapper expression
 *     language ({{moduleId.field}}) has no equivalent primitive without
 *     a real upstream module supplying the value, and this generator
 *     deliberately does not invent one (no Make module type name is used
 *     here unless it is the one, well-documented http:ActionSendData
 *     action — see the module's own comment below for why). The API key
 *     is therefore a clearly-named literal placeholder
 *     ("YOUR_PUBLIC_MAP_API_KEY") the importer edits directly in the
 *     HTTP module after import, exactly like a path-parameter
 *     placeholder — never a real key, and never an invented Make
 *     variable mechanism this generator can't verify.
 *
 * Usage: npx tsx scripts/generate-make-scenarios.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleForSchema as exampleForSchemaShared, extractOperations, loadOpenApiDoc } from "./lib/openapi-operations.mjs";

const OUT_DIR = join("templates", "make");

const { doc } = loadOpenApiDoc();
const exampleForSchema = (schema) => exampleForSchemaShared(doc, schema);
const operations = extractOperations(doc);
const API_BASE_URL = doc.servers[0].url;

/** {id} -> a literal placeholder the importer edits directly in the
 * module's URL field — same approach as the n8n generator's URL
 * placeholders, and Bruno's blank params:path fields. */
function resolvedUrl(path) {
  const withPlaceholders = path.replace(/\{(\w+)\}/g, (_match, name) => `YOUR_${name.toUpperCase()}`);
  return `${API_BASE_URL}${withPlaceholders}`;
}

/**
 * The "HTTP > Make a request" action — Make's own generic outbound HTTP
 * module (apiName "http:ActionSendData"), the same well-documented,
 * app-agnostic module every public Make blueprint that calls a REST API
 * without a dedicated Make app relies on. This is the ONLY Make module
 * type this generator uses, deliberately: every other Make module type
 * (Set variable(s), Router, Iterator, ...) would need a shape this
 * generator's author cannot verify against a real Make instance — see
 * templates/make/README.md.
 */
function httpActionModule(op, id) {
  const headers = [{ name: "Authorization", value: "Bearer YOUR_PUBLIC_MAP_API_KEY" }];
  if (op.method === "POST") {
    headers.push({ name: "Idempotency-Key", value: "REPLACE_WITH_A_UNIQUE_VALUE_PER_RUN" });
  }

  const mapper = {
    url: resolvedUrl(op.path),
    serializeUrl: false,
    method: op.method.toLowerCase(),
    headers,
    qs: [],
    bodyType: op.requestBodySchema ? "raw" : "empty",
    parseResponse: true,
    followRedirect: false,
    contentType: op.requestBodySchema ? "application/json" : undefined,
    data: op.requestBodySchema ? JSON.stringify(exampleForSchema(op.requestBodySchema), null, 2) : undefined,
  };

  return {
    id,
    module: "http:ActionSendData",
    version: 3,
    parameters: { handleErrors: false, useNewZLibDeCompress: true },
    mapper,
    metadata: {
      designer: { x: 0, y: 0 },
      restore: {},
    },
  };
}

function buildScenario(op) {
  return {
    name: `PUBLIC-MAP — ${op.summary}`,
    flow: [httpActionModule(op, 1)],
    metadata: {
      instant: false,
      version: 1,
      scenario: {
        roundtrips: 1,
        maxErrors: 3,
        autoCommit: true,
        autoCommitTriggerLast: true,
        sequential: false,
        confidential: false,
        dataloss: false,
        dlq: false,
        freshVariables: false,
      },
      designer: { orphans: [] },
    },
  };
}

mkdirSync(OUT_DIR, { recursive: true });

for (const op of operations) {
  const scenario = buildScenario(op);
  const outPath = join(OUT_DIR, `${op.operationId}.json`);
  writeFileSync(outPath, JSON.stringify(scenario, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

console.log(`\nGenerated ${operations.length} Make action scenario(s) — see templates/make/README.md for import instructions.`);
