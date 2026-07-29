import { readFileSync } from "node:fs";
import { join } from "node:path";

/** Serves the generated Postman collection — see collections/README.md;
 * regenerate via `npm run collections:generate`, never hand-edit the file. */
export async function GET() {
  const filePath = join(process.cwd(), "collections", "postman", "public-map-api.postman_collection.json");
  const contents = readFileSync(filePath, "utf8");

  return new Response(contents, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": 'attachment; filename="public-map-api.postman_collection.json"',
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    },
  });
}
