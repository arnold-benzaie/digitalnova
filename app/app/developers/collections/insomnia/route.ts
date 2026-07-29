import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Serves the generated Insomnia v4 export — see collections/README.md;
 * regenerate via `npm run collections:generate`, never hand-edit the file. */
export async function GET() {
  const filePath = join(process.cwd(), "collections", "insomnia", "public-map-api.insomnia.json");
  const contents = readFileSync(filePath, "utf8");

  return new Response(contents, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="public-map-api.insomnia.json"',
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    },
  });
}
