import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Serves the generated Bruno "production" environment file (bearerUrl/
 * bearerToken variables) — see collections/README.md. */
export async function GET() {
  const filePath = join(process.cwd(), "collections", "bruno", "environments", "production.bru");
  const contents = readFileSync(filePath, "utf8");

  return new Response(contents, {
    headers: {
      "Content-Type": "text/plain; charset=utf-8",
      "Content-Disposition": 'attachment; filename="production.bru"',
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    },
  });
}
