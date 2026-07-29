import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves a single generated n8n workflow template by exact filename —
 * whitelisted against the real directory listing on every request (never
 * trusts the URL segment directly), same pattern as
 * app/developers/collections/bruno/[file]/route.ts.
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const dir = join(process.cwd(), "templates", "n8n");
  const available = readdirSync(dir).filter((name) => name.endsWith(".json"));

  if (!available.includes(file)) {
    return new Response("Not found", { status: 404 });
  }

  const contents = readFileSync(join(dir, file), "utf8");

  return new Response(contents, {
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    },
  });
}
