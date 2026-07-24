import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClientDocuments } from "@/db/schema";
import { getCurrentSession } from "@/lib/session";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  // CRM is agency-shared (no organizationId scoping — see db/schema.ts on
  // crmClients), so any signed-in staff/admin can fetch any CRM document;
  // clients (portal-only role) must not.
  if (!session || session.role === "client") {
    return new Response("Non autorisé", { status: 401 });
  }

  const { id } = await params;

  const [document] = await db.select().from(crmClientDocuments).where(eq(crmClientDocuments.id, id)).limit(1);
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
