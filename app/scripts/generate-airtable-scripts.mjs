#!/usr/bin/env node
/**
 * Generates Airtable Automation "Run a script" snippets under
 * templates/airtable/** from the same single source of truth as the n8n
 * templates and Make scenarios — lib/api-v1/openapi.yaml, via
 * scripts/lib/openapi-operations.mjs (the module all three generators
 * share). See scripts/generate-n8n-templates.mjs and
 * scripts/generate-make-scenarios.mjs for the precedent this follows.
 *
 * Stage 8 (Airtable sub-stage) scope: ACTION scripts only — same
 * constraint as n8n/Make. No script here reacts to a PUBLIC-MAP event:
 * the event catalog is still a single internal-only event (see the
 * Stage 7 design note at /developers/docs/event-catalog).
 *
 * Airtable has NO portable "import this file and get a ready-made
 * automation" mechanism — unlike n8n (workflow JSON import) and Make
 * (blueprint JSON import). There is nothing to generate in either of
 * those two formats for Airtable. What IS real and well-documented is
 * Airtable's own "Run a script" automation action: a sandboxed
 * JavaScript step with global `input`, `fetch`, and `output` — so this
 * generator emits JavaScript SOURCE, meant to be pasted into that step's
 * code editor, not imported as a file. See templates/airtable/README.md
 * for the full explanation and the differences from n8n/Make.
 *
 * Usage: npx tsx scripts/generate-airtable-scripts.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleForSchema as exampleForSchemaShared, extractOperations, loadOpenApiDoc } from "./lib/openapi-operations.mjs";

const OUT_DIR = join("templates", "airtable");

const { doc } = loadOpenApiDoc();
const exampleForSchema = (schema) => exampleForSchemaShared(doc, schema);
const operations = extractOperations(doc);
const API_BASE_URL = doc.servers[0].url;

function pathParamNames(path) {
  return [...path.matchAll(/\{(\w+)\}/g)].map((m) => m[1]);
}

/** Builds the URL template-literal expression the generated script uses —
 * `${baseUrl}` plus one `${config.<paramName>}` interpolation per path
 * parameter, e.g. "`${baseUrl}/audits/${config.id}`". */
function urlExpression(path) {
  const withInterpolation = path.replace(/\{(\w+)\}/g, (_m, name) => "${config." + name + "}");
  return "`${baseUrl}" + withInterpolation + "`";
}

/** Reindents every line of a multi-line string by `spaces`, leaving the
 * first line untouched (the caller already positions it inline). */
function indentContinuationLines(text, spaces) {
  const pad = " ".repeat(spaces);
  return text
    .split("\n")
    .map((line, i) => (i === 0 ? line : pad + line))
    .join("\n");
}

function buildScript(op) {
  const params = pathParamNames(op.path);
  const configComment = [
    "// Configure these as the script step's input variables in the Airtable automation editor:",
    "//   apiKey  -> a real PUBLIC-MAP API key (Developer Console) — never hardcode one here",
    "//   baseUrl -> optional override, defaults to the real API below",
    ...params.map((p) => `//   ${p} -> the real ${p} to use in this request`),
  ].join("\n");

  const headerEntries = [`    Authorization: \`Bearer \${apiKey}\`,`];
  if (op.requestBodySchema) headerEntries.push(`    "Content-Type": "application/json",`);
  if (op.method === "POST") {
    headerEntries.push(`    "Idempotency-Key": \`\${Date.now()}-\${Math.random().toString(36).slice(2)}\`,`);
  }

  const fetchOptionLines = [`  method: "${op.method}",`, `  headers: {`, ...headerEntries, `  },`];
  if (op.requestBodySchema) {
    const bodyJson = JSON.stringify(exampleForSchema(op.requestBodySchema), null, 2);
    fetchOptionLines.push(`  body: JSON.stringify(${indentContinuationLines(bodyJson, 2)}),`);
  }

  return `// PUBLIC-MAP — ${op.summary}
// Airtable Automation "Run a script" step. This is source code to PASTE
// into that step's code editor — Airtable has no file-import mechanism
// for automations, unlike the n8n/Make templates. See
// templates/airtable/README.md for full setup instructions, including
// which trigger to use (never a webhook trigger — see that file).
//
${configComment}

const config = input.config();
const baseUrl = config.baseUrl || "${API_BASE_URL}";
const apiKey = config.apiKey;

if (!apiKey) {
  throw new Error('Set the "apiKey" input variable to a real PUBLIC-MAP API key before running this step.');
}

const url = ${urlExpression(op.path)};

const response = await fetch(url, {
${fetchOptionLines.join("\n")}
});

const responseBody = await response.json();
if (!response.ok) {
  throw new Error(\`PUBLIC-MAP API error (\${response.status}): \${JSON.stringify(responseBody)}\`);
}

output.set("responseStatus", response.status);
output.set("responseBody", responseBody);
`;
}

mkdirSync(OUT_DIR, { recursive: true });

for (const op of operations) {
  const script = buildScript(op);
  const outPath = join(OUT_DIR, `${op.operationId}.js`);
  writeFileSync(outPath, script, "utf8");
  console.log(`Wrote ${outPath}`);
}

console.log(`\nGenerated ${operations.length} Airtable action script(s) — see templates/airtable/README.md for setup instructions.`);
