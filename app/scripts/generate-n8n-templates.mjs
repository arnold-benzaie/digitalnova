#!/usr/bin/env node
/**
 * Generates n8n workflow templates under templates/n8n/** from the same
 * single source of truth as the Postman/Bruno/Insomnia collections,
 * lib/api-v1/openapi.yaml — see scripts/lib/openapi-operations.mjs (the
 * module both generators share) and scripts/generate-client-collections.mjs
 * for the precedent this follows.
 *
 * Stage 8 (n8n sub-stage) scope: ACTION templates only — one per real
 * /api/v1 operation, each starting from n8n's Manual Trigger node (a
 * human clicking "Execute Workflow," never an automated reaction to a
 * PUBLIC-MAP event). No webhook-TRIGGER template is generated here: the
 * event catalog is still a single internal-only event
 * (lib/integrations/governance.ts, see the Stage 7 design note at
 * /developers/docs/event-catalog) — building a template that reacts to a
 * PUBLIC-MAP event would require an event that doesn't exist for any
 * customer-facing domain yet.
 *
 * No API key is ever embedded in a template: the HTTP Request node reads
 * PUBLIC_MAP_BASE_URL and PUBLIC_MAP_API_KEY from n8n's own environment
 * variables ({{$env...}}), which the person importing the template sets
 * on their own n8n instance — never something this generator, or PUBLIC-
 * MAP, can see or ship a value for.
 *
 * Usage: npx tsx scripts/generate-n8n-templates.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { randomUUID } from "node:crypto";
import { join } from "node:path";
import { exampleForSchema as exampleForSchemaShared, extractOperations, loadOpenApiDoc } from "./lib/openapi-operations.mjs";

const OUT_DIR = join("templates", "n8n");

const { doc } = loadOpenApiDoc();
const exampleForSchema = (schema) => exampleForSchemaShared(doc, schema);
const operations = extractOperations(doc);

/** {id} -> a literal placeholder the importer edits directly in the node's
 * URL field — same "blank field for the user to fill" approach as the
 * Bruno collection's params:path, just expressed as inline URL text since
 * the HTTP Request node has no separate path-parameter UI. */
function resolvedUrlExpression(path) {
  const withPlaceholders = path.replace(/\{(\w+)\}/g, (_match, name) => `YOUR_${name.toUpperCase()}`);
  return `={{$env.PUBLIC_MAP_BASE_URL}}${withPlaceholders}`;
}

function httpRequestNode(op) {
  const headerParameters = [{ name: "Authorization", value: "=Bearer {{$env.PUBLIC_MAP_API_KEY}}" }];

  const parameters = {
    method: op.method,
    url: resolvedUrlExpression(op.path),
    authentication: "none",
    sendHeaders: true,
    headerParameters: { parameters: headerParameters },
    options: {},
  };

  if (op.requestBodySchema) {
    if (op.method === "POST") {
      headerParameters.push({ name: "Idempotency-Key", value: "={{$workflow.id}}-{{$now.toMillis()}}" });
    }
    parameters.sendBody = true;
    parameters.specifyBody = "json";
    parameters.jsonBody = JSON.stringify(exampleForSchema(op.requestBodySchema), null, 2);
  }

  return {
    parameters,
    id: randomUUID(),
    name: "PUBLIC-MAP API",
    type: "n8n-nodes-base.httpRequest",
    typeVersion: 4.2,
    position: [460, 300],
  };
}

function manualTriggerNode() {
  return {
    parameters: {},
    id: randomUUID(),
    name: "Manual Trigger",
    type: "n8n-nodes-base.manualTrigger",
    typeVersion: 1,
    position: [240, 300],
  };
}

function buildWorkflow(op) {
  const httpNode = httpRequestNode(op);
  const triggerNode = manualTriggerNode();

  return {
    name: `PUBLIC-MAP — ${op.summary}`,
    nodes: [triggerNode, httpNode],
    connections: {
      [triggerNode.name]: { main: [[{ node: httpNode.name, type: "main", index: 0 }]] },
    },
    pinData: {},
    meta: { templateCredsSetupCompleted: false },
  };
}

mkdirSync(OUT_DIR, { recursive: true });

for (const op of operations) {
  const workflow = buildWorkflow(op);
  const outPath = join(OUT_DIR, `${op.operationId}.json`);
  writeFileSync(outPath, JSON.stringify(workflow, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

console.log(`\nGenerated ${operations.length} n8n action template(s) — see templates/n8n/README.md for import instructions.`);
