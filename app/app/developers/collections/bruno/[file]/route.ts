import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves a single file from the generated Bruno collection, by exact
 * filename — whitelisted against the real directory listing on every
 * request (never trusts the URL segment directly) so this can never be
 * used to read an arbitrary file on disk.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const dir = join(process.cwd(), "collections", "bruno");
  const available = readdirSync(dir).filter((name) => name.endsWith(".bru") || name === "bruno.json");

  if (!available.includes(file)) {
    return new Response("Not found", { status: 404 });
  }

  const contents = readFileSync(join(dir, file), "utf8");
  const contentType = file.endsWith(".json") ? "application/json; charset=utf-8" : "text/plain; charset=utf-8";

  return new Response(contents, {
    headers: {
      "Content-Type": contentType,
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    },
  });
}
