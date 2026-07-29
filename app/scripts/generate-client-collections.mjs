#!/usr/bin/env node
/**
 * Generates the Postman, Bruno, and Insomnia collections under
 * collections/** from the single source of truth, lib/api-v1/openapi.yaml
 * — never hand-edit the files under collections/, regenerate them here
 * instead. This is what "reuse the OpenAPI spec, avoid duplication" means
 * for these three deliverables (see the Stage 2 architecture note in
 * /developers/docs/sdk-usage).
 *
 * - Postman: the official `openapi-to-postmanv2` converter (Postman's own
 *   package) — full fidelity (auth, examples, variables).
 * - Bruno and Insomnia: hand-written here directly from the parsed spec.
 *   Bruno's own OpenAPI importer (`@usebruno/converters`) and Insomnia's
 *   own (`insomnia-importers`) were evaluated first but rejected: the
 *   former's output needs an internal collection-JSON → .bru-file
 *   transform this package doesn't expose (undocumented, would have
 *   meant guessing at private app internals); the latter pulled in ~210
 *   transitive packages including a critical XML-parsing CVE for a WSDL
 *   importer this project will never use. Both formats are simple,
 *   well-documented text/JSON shapes — safer to generate directly from
 *   data we already fully control than to add that dependency weight.
 *
 * Usage: npx tsx scripts/generate-client-collections.mjs
 */
import { existsSync, mkdirSync, rmSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { convert as convertToPostman } from "openapi-to-postmanv2";
import { exampleForSchema as exampleForSchemaShared, extractOperations, loadOpenApiDoc } from "./lib/openapi-operations.mjs";

const OUT_DIR = "collections";

const { doc, specText } = loadOpenApiDoc();
const exampleForSchema = (schema) => exampleForSchemaShared(doc, schema);
const operations = extractOperations(doc);

// ---------------------------------------------------------------------
// Postman — official converter, full fidelity.
// ---------------------------------------------------------------------
async function generatePostman() {
  const collection = await new Promise((resolvePromise, reject) => {
    convertToPostman({ type: "string", data: specText }, {}, (err, result) => {
      if (err) return reject(err);
      if (!result.result) return reject(new Error(`openapi-to-postmanv2 failed: ${result.reason}`));
      resolvePromise(result.output[0].data);
    });
  });

  // Declare `apiKey` as an empty collection variable alongside the
  // auto-declared `baseUrl` — openapi-to-postmanv2 only declares
  // variables it can infer from the spec's `servers`, not auth secrets.
  collection.variable ??= [];
  if (!collection.variable.some((v) => v.key === "bearerToken")) {
    collection.variable.push({ key: "bearerToken", value: "", type: "string" });
  }

  const dir = join(OUT_DIR, "postman");
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, "public-map-api.postman_collection.json");
  writeFileSync(outPath, JSON.stringify(collection, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

// ---------------------------------------------------------------------
// Bruno — hand-written .bru files (see module docstring for why).
// ---------------------------------------------------------------------
function bruEscapeMultiline(text) {
  return text
    .trim()
    .split("\n")
    .map((line) => `    ${line}`)
    .join("\n");
}

function buildBruFile(op, seq) {
  const methodLower = op.method.toLowerCase();
  const lines = [];

  lines.push("meta {", `  name: ${op.summary}`, "  type: http", `  seq: ${seq}`, "}", "");

  lines.push(
    `${methodLower} {`,
    `  url: {{baseUrl}}${op.path.replace(/{(\w+)}/g, ":$1")}`,
    `  body: ${op.requestBodySchema ? "json" : "none"}`,
    "  auth: bearer",
    "}",
    "",
  );

  lines.push("auth:bearer {", "  token: {{bearerToken}}", "}", "");

  const pathParams = op.parameters.filter((p) => p.in === "path");
  if (pathParams.length > 0) {
    lines.push("params:path {");
    for (const p of pathParams) lines.push(`  ${p.name}: `);
    lines.push("}", "");
  }

  const queryParams = op.parameters.filter((p) => p.in === "query");
  if (queryParams.length > 0) {
    lines.push("params:query {");
    for (const p of queryParams) lines.push(`  ~${p.name}: `);
    lines.push("}", "");
  }

  const headerParams = op.parameters.filter((p) => p.in === "header");
  if (headerParams.length > 0) {
    lines.push("headers {");
    for (const p of headerParams) lines.push(`  ~${p.name}: `);
    lines.push("}", "");
  }

  if (op.requestBodySchema) {
    const example = JSON.stringify(exampleForSchema(op.requestBodySchema), null, 2);
    lines.push("body:json {", bruEscapeMultiline(example), "}", "");
  }

  if (op.scopes.length > 0) {
    lines.push("docs {", bruEscapeMultiline(`${op.description}\n\nRequired scope(s): ${op.scopes.join(", ")}`), "}", "");
  } else {
    lines.push("docs {", bruEscapeMultiline(op.description || op.summary), "}", "");
  }

  return lines.join("\n") + "\n";
}

function generateBruno() {
  const dir = join(OUT_DIR, "bruno");
  if (existsSync(dir)) rmSync(dir, { recursive: true });
  mkdirSync(join(dir, "environments"), { recursive: true });

  operations.forEach((op, i) => {
    const fileName = `${op.operationId}.bru`;
    writeFileSync(join(dir, fileName), buildBruFile(op, i + 1), "utf8");
  });

  const brunoJson = {
    version: "1",
    name: doc.info.title,
    type: "collection",
  };
  writeFileSync(join(dir, "bruno.json"), JSON.stringify(brunoJson, null, 2) + "\n", "utf8");

  const productionEnv = ["vars {", `  baseUrl: ${doc.servers[0].url}`, "  bearerToken: ", "}", ""].join("\n");
  writeFileSync(join(dir, "environments", "production.bru"), productionEnv, "utf8");

  console.log(`Wrote ${operations.length} .bru file(s) to ${dir}/`);
}

// ---------------------------------------------------------------------
// Insomnia — hand-written v4 export (see module docstring for why).
// ---------------------------------------------------------------------
function generateInsomnia() {
  const workspaceId = "wrk_public_map_api";
  const baseEnvId = "env_public_map_api_base";
  const folderId = "fld_public_map_api";
  const now = Date.now();

  const resources = [
    {
      _id: workspaceId,
      _type: "workspace",
      parentId: null,
      name: doc.info.title,
      description: doc.info.description,
      scope: "collection",
    },
    {
      _id: baseEnvId,
      _type: "environment",
      parentId: workspaceId,
      name: "Base Environment",
      data: { baseUrl: doc.servers[0].url, bearerToken: "" },
      dataPropertyOrder: { "&": ["baseUrl", "bearerToken"] },
    },
    {
      _id: folderId,
      _type: "request_group",
      parentId: workspaceId,
      name: "PUBLIC-MAP API",
    },
  ];

  operations.forEach((op, i) => {
    const bodyExample = op.requestBodySchema ? exampleForSchema(op.requestBodySchema) : undefined;
    resources.push({
      _id: `req_${op.operationId}`,
      _type: "request",
      parentId: folderId,
      name: op.summary,
      description: op.description,
      method: op.method,
      url: `{{ _.baseUrl }}${op.path.replace(/{(\w+)}/g, "{{ _.$1 }}")}`,
      authentication: { type: "bearer", token: "{{ _.bearerToken }}" },
      headers: bodyExample ? [{ name: "Content-Type", value: "application/json" }] : [],
      body: bodyExample ? { mimeType: "application/json", text: JSON.stringify(bodyExample, null, 2) } : {},
      parameters: op.parameters.filter((p) => p.in === "query").map((p) => ({ name: p.name, value: "", disabled: true })),
      metaSortKey: -now + i,
    });
  });

  const exportDoc = {
    _type: "export",
    __export_format: 4,
    __export_date: new Date().toISOString(),
    __export_source: "public-map.scripts.generate-client-collections",
    resources,
  };

  const dir = join(OUT_DIR, "insomnia");
  mkdirSync(dir, { recursive: true });
  const outPath = join(dir, "public-map-api.insomnia.json");
  writeFileSync(outPath, JSON.stringify(exportDoc, null, 2) + "\n", "utf8");
  console.log(`Wrote ${outPath}`);
}

await generatePostman();
generateBruno();
generateInsomnia();
