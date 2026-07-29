/**
 * Shared OpenAPI-spec parsing helpers — extracted from
 * generate-client-collections.mjs (Stage 2) so generate-n8n-templates.mjs
 * (Stage 8) can reuse the exact same operation list and example-value
 * logic instead of re-parsing lib/api-v1/openapi.yaml a second way.
 * Every client-facing artifact generated from the spec (Postman/Bruno/
 * Insomnia collections, n8n templates) must derive from this one place.
 */
import { readFileSync } from "node:fs";
import { join } from "node:path";
import yaml from "js-yaml";

const SPEC_PATH = join("lib", "api-v1", "openapi.yaml");

export function loadOpenApiDoc() {
  const specText = readFileSync(SPEC_PATH, "utf8");
  return { doc: yaml.load(specText), specText };
}

function resolveRef(doc, ref) {
  const parts = ref.replace(/^#\//, "").split("/");
  let node = doc;
  for (const part of parts) node = node[part];
  return node;
}

function resolve(doc, node) {
  return node && typeof node === "object" && "$ref" in node ? resolveRef(doc, node.$ref) : node;
}

/** Every {method, path, operationId, summary, description, scopes,
 * parameters, requestBodySchema} in the spec, in document order. */
export function extractOperations(doc) {
  const operations = [];
  for (const [path, pathItem] of Object.entries(doc.paths)) {
    for (const method of ["get", "post", "patch", "put", "delete"]) {
      const op = pathItem[method];
      if (!op) continue;
      const security = op.security?.[0] ?? {};
      const scopes = Object.values(security)[0] ?? [];
      const parameters = (op.parameters ?? []).map((p) => resolve(doc, p));
      const requestBodySchema = op.requestBody
        ? resolve(doc, resolve(doc, op.requestBody).content["application/json"].schema)
        : null;
      operations.push({
        method: method.toUpperCase(),
        path,
        operationId: op.operationId,
        summary: op.summary,
        description: op.description ?? "",
        scopes,
        parameters,
        requestBodySchema,
      });
    }
  }
  return operations;
}

/** A minimal, validly-shaped example value for a resolved JSON schema —
 * used to pre-fill request bodies in every generated artifact. */
export function exampleForSchema(doc, schema) {
  if (!schema) return undefined;
  if (schema.enum) return schema.enum[0];
  if (schema.format === "uuid") return "00000000-0000-0000-0000-000000000000";
  if (schema.format === "date-time") return "2026-01-01T00:00:00Z";
  switch (schema.type) {
    case "string":
      return "";
    case "integer":
    case "number":
      return 0;
    case "boolean":
      return false;
    case "object": {
      const obj = {};
      for (const key of schema.required ?? Object.keys(schema.properties ?? {})) {
        const propSchema = resolve(doc, schema.properties?.[key]);
        if (propSchema) obj[key] = exampleForSchema(doc, propSchema);
      }
      return obj;
    }
    default:
      return null;
  }
}
