import { readFileSync } from "node:fs";
import { join } from "node:path";

/**
 * Stable public URL for the /api/v1 OpenAPI spec — the single source of
 * truth (lib/api-v1/openapi.yaml, hand-maintained alongside the routes it
 * describes) served as-is, byte for byte. Both /developers/reference's
 * embedded viewer and any external tool (Postman/Bruno/Insomnia import,
 * a future SDK generator) can point at this one URL instead of needing a
 * copy of the file.
 */
export async function GET() {
  const specPath = join(process.cwd(), "lib", "api-v1", "openapi.yaml");
  const contents = readFileSync(specPath, "utf8");

  return new Response(contents, {
    headers: {
      "Content-Type": "application/yaml; charset=utf-8",
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    },
  });
}
