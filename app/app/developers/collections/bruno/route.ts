import { readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Lists the generated Bruno collection's files — Bruno's format is a
 * folder, not a single importable file (see collections/README.md for
 * why this portal serves per-file downloads rather than a zip), so the
 * /developers/collections page fetches this to render real download
 * links instead of hardcoding the operation list (which would drift from
 * the generator's actual output).
 */
export async function GET() {
  const dir = join(process.cwd(), "collections", "bruno");
  const files = readdirSync(dir).filter((name) => name.endsWith(".bru") || name === "bruno.json");

  return Response.json({ files: files.sort(), environmentFile: "production.bru" });
}
