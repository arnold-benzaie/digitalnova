#!/usr/bin/env node
/**
 * Generates the Zapier Platform resource modules under
 * zapier/{triggers,searches,creates}/** from the same single source of
 * truth as the n8n templates, Make scenarios, and Airtable scripts —
 * lib/api-v1/openapi.yaml, via scripts/lib/openapi-operations.mjs (the
 * module all four generators share). See scripts/generate-n8n-
 * templates.mjs, scripts/generate-make-scenarios.mjs, and
 * scripts/generate-airtable-scripts.mjs for the precedent this follows.
 *
 * Stage 8 (Zapier sub-stage) scope, and how it differs from n8n/Make/
 * Airtable — see zapier/README.md for the full explanation:
 *   - Zapier's real platform has THREE distinct resource kinds, not one
 *     generic "action": triggers (polling, since no instant/webhook
 *     trigger is possible — see below), searches (find one record), and
 *     creates (write actions). Every real GET-list operation becomes a
 *     polling trigger; every real GET-single operation becomes a search;
 *     every real POST/PATCH operation becomes a create.
 *   - NO instant/webhook trigger is generated for anything, on purpose:
 *     that would require the event catalog (still a single internal-only
 *     event — see /developers/docs/event-catalog), and no workaround is
 *     invented for that gap. The polling triggers generated here are NOT
 *     a workaround for that — they're Zapier's own, equally legitimate,
 *     equally official trigger mechanism, built entirely on the /api/v1
 *     read routes that already exist today.
 *   - No API key is ever embedded: every generated module relies on
 *     zapier/authentication.js's beforeRequest hook to attach
 *     "Authorization: Bearer <apiKey>" — the key itself lives only in
 *     Zapier's own encrypted per-user connection storage.
 *
 * Response DTO field names (used for `sample`/`outputFields` below) come
 * from lib/api-v1/dto.ts — read directly, never guessed — since
 * extractOperations() only captures REQUEST-side shape (parameters,
 * request bodies), not response shapes, which the OpenAPI spec models via
 * $ref'd response schemas this generator does not parse.
 *
 * Usage: npx tsx scripts/generate-zapier-app.mjs
 */
import { mkdirSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import { exampleForSchema as exampleForSchemaShared, extractOperations, loadOpenApiDoc } from "./lib/openapi-operations.mjs";

const ZAPIER_DIR = "zapier";

const { doc } = loadOpenApiDoc();
const exampleForSchema = (schema) => exampleForSchemaShared(doc, schema);
const operationsById = Object.fromEntries(extractOperations(doc).map((op) => [op.operationId, op]));

/** Resource metadata — hand-mapped once, from the real DTOs in
 * lib/api-v1/dto.ts, not derived automatically (see module docstring for
 * why response shapes aren't part of the shared parsing module). */
const TRIGGERS = [
  {
    listOperationId: "listAudits",
    key: "new_audit",
    noun: "Audit",
    label: "New Audit",
    description:
      "Triggers when a new audit is found, polling GET /audits (sorted newest-first by the real API). No instant/webhook trigger exists yet — see README.md.",
    sample: {
      id: "00000000-0000-0000-0000-000000000000",
      score: 82,
      summary: "Sample audit summary.",
      createdAt: "2026-01-01T00:00:00.000Z",
      location: { id: "00000000-0000-0000-0000-000000000001", name: "Sample Location", address: "1 Sample St" },
    },
    outputFields: [
      { key: "id", label: "Audit ID" },
      { key: "score", label: "Score", type: "integer" },
      { key: "summary", label: "Summary" },
      { key: "createdAt", label: "Created At", type: "datetime" },
      { key: "location__id", label: "Location ID" },
      { key: "location__name", label: "Location Name" },
    ],
  },
  {
    listOperationId: "listClients",
    key: "new_client",
    noun: "Client",
    label: "New Client",
    description: "Triggers when a new client is found, polling GET /clients (sorted newest-first by the real API).",
    sample: {
      id: "00000000-0000-0000-0000-000000000000",
      name: "Sample Client",
      contactName: "Jane Doe",
      email: "jane@example.com",
      phone: null,
      address: null,
      stage: "lead",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    outputFields: [
      { key: "id", label: "Client ID" },
      { key: "name", label: "Name" },
      { key: "contactName", label: "Contact Name" },
      { key: "email", label: "Email" },
      { key: "stage", label: "Stage" },
      { key: "createdAt", label: "Created At", type: "datetime" },
    ],
  },
  {
    listOperationId: "listReports",
    key: "new_report",
    noun: "Report",
    label: "New Report",
    description: "Triggers when a new report is found, polling GET /reports (sorted newest-first by the real API).",
    sample: {
      id: "00000000-0000-0000-0000-000000000000",
      score: 82,
      summary: "Sample report summary.",
      createdAt: "2026-01-01T00:00:00.000Z",
      location: null,
      issueCount: 3,
      issueCounts: { low: 1, medium: 1, high: 1 },
    },
    outputFields: [
      { key: "id", label: "Report ID" },
      { key: "score", label: "Score", type: "integer" },
      { key: "summary", label: "Summary" },
      { key: "issueCount", label: "Issue Count", type: "integer" },
      { key: "createdAt", label: "Created At", type: "datetime" },
    ],
  },
];

const SEARCHES = [
  {
    getOperationId: "getAudit",
    key: "find_audit",
    noun: "Audit",
    label: "Find Audit",
    description: "Finds a single audit by ID (GET /audits/{id}).",
    idField: "auditId",
    idLabel: "Audit ID",
    sample: TRIGGERS[0].sample,
    outputFields: TRIGGERS[0].outputFields,
  },
  {
    getOperationId: "getClient",
    key: "find_client",
    noun: "Client",
    label: "Find Client",
    description: "Finds a single client by ID (GET /clients/{id}).",
    idField: "clientId",
    idLabel: "Client ID",
    sample: TRIGGERS[1].sample,
    outputFields: TRIGGERS[1].outputFields,
  },
  {
    getOperationId: "getReport",
    key: "find_report",
    noun: "Report",
    label: "Find Report",
    description: "Finds a single report by ID (GET /reports/{id}).",
    idField: "reportId",
    idLabel: "Report ID",
    sample: TRIGGERS[2].sample,
    outputFields: TRIGGERS[2].outputFields,
  },
];

const CREATES = [
  {
    operationId: "createTask",
    key: "create_task",
    noun: "Task",
    label: "Create Task",
    description: "Creates a staff to-do tied to a client (POST /tasks). Supports Idempotency-Key to safely retry.",
    sample: {
      id: "00000000-0000-0000-0000-000000000000",
      clientId: "00000000-0000-0000-0000-000000000001",
      title: "Sample task",
      description: null,
      dueDate: null,
      status: "todo",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    outputFields: [
      { key: "id", label: "Task ID" },
      { key: "clientId", label: "Client ID" },
      { key: "title", label: "Title" },
      { key: "status", label: "Status" },
      { key: "createdAt", label: "Created At", type: "datetime" },
    ],
  },
  {
    operationId: "createInteraction",
    key: "create_interaction",
    noun: "Interaction",
    label: "Log Interaction",
    description: "Logs a client interaction (POST /interactions). Supports Idempotency-Key to safely retry.",
    sample: {
      id: "00000000-0000-0000-0000-000000000000",
      clientId: "00000000-0000-0000-0000-000000000001",
      type: "call",
      summary: "Sample interaction summary.",
      occurredAt: "2026-01-01T00:00:00.000Z",
      createdAt: "2026-01-01T00:00:00.000Z",
    },
    outputFields: [
      { key: "id", label: "Interaction ID" },
      { key: "clientId", label: "Client ID" },
      { key: "type", label: "Type" },
      { key: "summary", label: "Summary" },
      { key: "occurredAt", label: "Occurred At", type: "datetime" },
    ],
  },
  {
    operationId: "updateClient",
    key: "update_client",
    noun: "Client",
    label: "Update Client",
    description: "Updates a client's whitelisted fields (PATCH /clients/{id}).",
    idField: "clientId",
    idLabel: "Client ID",
    sample: TRIGGERS[1].sample,
    outputFields: TRIGGERS[1].outputFields,
  },
];

function jsLiteral(value, indent = 2) {
  return JSON.stringify(value, null, 2)
    .split("\n")
    .map((line, i) => (i === 0 ? line : " ".repeat(indent) + line))
    .join("\n");
}

function inputFieldsFor(op, extra = []) {
  const fields = [...extra];
  if (op.requestBodySchema) {
    const example = exampleForSchema(op.requestBodySchema);
    for (const key of Object.keys(example)) {
      fields.push({
        key,
        label: key,
        required: (op.requestBodySchema.required ?? []).includes(key),
        type: typeof example[key] === "number" ? "integer" : undefined,
      });
    }
  }
  return fields.map((f) => ({ key: f.key, label: f.label, required: f.required, type: f.type })).filter((f) => f.key);
}

function buildTrigger({ listOperationId, key, noun, label, description, sample, outputFields }) {
  const op = operationsById[listOperationId];
  return `"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "${op.operationId}" (${op.method} ${op.path}).
//
// Polling trigger: the real /api/v1 list route already returns
// newest-first (orderBy(desc(createdAt)) server-side) — Zapier dedupes
// polled items by "id" automatically, so no manual cursor/date-tracking
// logic is needed here.
const perform = async (z, bundle) => {
  const response = await z.request({
    url: \`\${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}${op.path}\`,
    params: { limit: 50 },
  });
  return response.data.data;
};

module.exports = {
  key: "${key}",
  noun: "${noun}",
  display: {
    label: "${label}",
    description: ${JSON.stringify(description)},
  },
  operation: {
    type: "polling",
    perform,
    sample: ${jsLiteral(sample)},
    outputFields: ${jsLiteral(outputFields)},
  },
};
`;
}

function buildSearch({ getOperationId, key, noun, label, description, idField, idLabel, sample, outputFields }) {
  const op = operationsById[getOperationId];
  const resolvedPath = op.path.replace(/\{(\w+)\}/g, () => "${bundle.inputData." + idField + "}");
  return `"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "${op.operationId}" (${op.method} ${op.path}).
const perform = async (z, bundle) => {
  const response = await z.request({
    url: \`\${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}${resolvedPath}\`,
  });
  return [response.data.data];
};

module.exports = {
  key: "${key}",
  noun: "${noun}",
  display: {
    label: "${label}",
    description: ${JSON.stringify(description)},
  },
  operation: {
    inputFields: [
      { key: "${idField}", label: "${idLabel}", required: true },
    ],
    perform,
    sample: ${jsLiteral(sample)},
    outputFields: ${jsLiteral(outputFields)},
  },
};
`;
}

function buildCreate({ operationId, key, noun, label, description, idField, idLabel, sample, outputFields }) {
  const op = operationsById[operationId];
  const hasPathParam = /\{(\w+)\}/.test(op.path);
  const resolvedPath = hasPathParam ? op.path.replace(/\{(\w+)\}/g, () => "${bundle.inputData." + idField + "}") : op.path;
  const extraFields = hasPathParam ? [{ key: idField, label: idLabel, required: true }] : [];
  const isWrite = Boolean(op.requestBodySchema);

  const bodyLines = isWrite
    ? [
        "  const body = {};",
        `  for (const key of ${JSON.stringify(Object.keys(exampleForSchema(op.requestBodySchema)))}) {`,
        "    if (bundle.inputData[key] !== undefined) body[key] = bundle.inputData[key];",
        "  }",
      ]
    : [];

  const requestOptions = [`    url: \`\${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}${resolvedPath}\`,`, `    method: "${op.method}",`];
  if (isWrite) {
    requestOptions.push("    body,");
    if (op.method === "POST") {
      requestOptions.push("    headers: { \"Idempotency-Key\": idempotencyKey },");
    }
  }

  const idempotencyLine =
    op.method === "POST"
      ? '  // Stable per identical input: z.hash() of the input data itself, so a\n  // real Zapier-retried perform() (e.g. after a timeout) reuses the same\n  // key instead of double-creating — see the Idempotency guide\n  // (/developers/docs/idempotency) for what the real API does with a\n  // repeated key. Genuinely different input always hashes differently.\n  const idempotencyKey = z.hash("sha256", JSON.stringify(bundle.inputData));\n'
      : "";

  return `"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "${op.operationId}" (${op.method} ${op.path}).
const perform = async (z, bundle) => {
${idempotencyLine}${bodyLines.join("\n")}
  const response = await z.request({
${requestOptions.join("\n")}
  });
  return response.data.data;
};

module.exports = {
  key: "${key}",
  noun: "${noun}",
  display: {
    label: "${label}",
    description: ${JSON.stringify(description)},
  },
  operation: {
    inputFields: ${jsLiteral([...extraFields, ...inputFieldsFor(op)])},
    perform,
    sample: ${jsLiteral(sample)},
    outputFields: ${jsLiteral(outputFields)},
  },
};
`;
}

mkdirSync(join(ZAPIER_DIR, "triggers"), { recursive: true });
mkdirSync(join(ZAPIER_DIR, "searches"), { recursive: true });
mkdirSync(join(ZAPIER_DIR, "creates"), { recursive: true });

for (const trigger of TRIGGERS) {
  const outPath = join(ZAPIER_DIR, "triggers", `${trigger.key}.js`);
  writeFileSync(outPath, buildTrigger(trigger), "utf8");
  console.log(`Wrote ${outPath}`);
}

for (const search of SEARCHES) {
  const outPath = join(ZAPIER_DIR, "searches", `${search.key}.js`);
  writeFileSync(outPath, buildSearch(search), "utf8");
  console.log(`Wrote ${outPath}`);
}

for (const create of CREATES) {
  const outPath = join(ZAPIER_DIR, "creates", `${create.key}.js`);
  writeFileSync(outPath, buildCreate(create), "utf8");
  console.log(`Wrote ${outPath}`);
}

console.log(`\nGenerated ${TRIGGERS.length} trigger(s), ${SEARCHES.length} search(es), ${CREATES.length} create(s) — see zapier/README.md.`);
