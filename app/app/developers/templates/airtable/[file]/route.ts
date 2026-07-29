import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";

/**
 * Serves a single generated Airtable automation script by exact filename
 * — whitelisted against the real directory listing on every request
 * (never trusts the URL segment directly), same pattern as
 * app/developers/templates/{n8n,make}/[file]/route.ts. Served as
 * downloadable JavaScript source — meant to be opened and its contents
 * pasted into Airtable's own "Run a script" step editor, not imported as
 * a file (Airtable has no import mechanism for automations — see
 * templates/airtable/README.md).
 */
export async function GET(_request: Request, { params }: { params: Promise<{ file: string }> }) {
  const { file } = await params;
  const dir = join(process.cwd(), "templates", "airtable");
  const available = readdirSync(dir).filter((name) => name.endsWith(".js"));

  if (!available.includes(file)) {
    return new Response("Not found", { status: 404 });
  }

  const contents = readFileSync(join(dir, file), "utf8");

  return new Response(contents, {
    headers: {
      "Content-Type": "text/javascript; charset=utf-8",
      "Content-Disposition": `attachment; filename="${file}"`,
      "Cache-Control": "public, max-age=300, stale-while-revalidate=60",
    },
  });
}
