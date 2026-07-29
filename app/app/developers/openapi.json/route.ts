import { readFileSync } from "node:fs";
import { join } from "node:path";
import { load } from "js-yaml";

/**
 * JSON sibling of /developers/openapi.yaml — same single source of truth
 * (lib/api-v1/openapi.yaml), parsed and re-served as JSON for tools that
 * expect that format (Swagger UI variants, some codegen pipelines). Never
 * a second hand-maintained copy of the spec.
 */
export async function GET() {
  const specPath = join(process.cwd(), "lib", "api-v1", "openapi.yaml");
  const specText = readFileSync(specPath, "utf8");
  const doc = load(specText);

  return Response.json(doc, {
    headers: {
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    },
  });
}
