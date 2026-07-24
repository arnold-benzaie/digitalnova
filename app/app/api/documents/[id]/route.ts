import { and, eq } from "drizzle-orm";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { getCurrentSession } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  if (!session) {
    return new Response("Non autorisé", { status: 401 });
  }

  const { id } = await params;

  // proxy.ts only proves *a* session exists — it doesn't know which
  // organization owns this specific document, so that check has to happen
  // here (this is exactly the class of gap the app's own error.tsx and
  // lib/session.ts comments call out: middleware path-matching alone isn't
  // enough, ownership must be re-checked at the resource).
  const [document] = await db
    .select()
    .from(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, session.organizationId)))
    .limit(1);
  if (!document) {
    return new Response("Document introuvable", { status: 404 });
  }

  const buffer = Buffer.from(document.content, "base64");
  return new Response(new Uint8Array(buffer), {
    headers: {
      "Content-Type": document.mimeType,
      "Content-Disposition": `attachment; filename="${encodeURIComponent(document.fileName)}"`,
      "Content-Length": String(document.sizeBytes),
    },
  });
}
