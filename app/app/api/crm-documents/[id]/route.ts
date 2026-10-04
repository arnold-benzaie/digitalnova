import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClientDocuments, crmClients } from "@/db/schema";
import { getCurrentSession } from "@/lib/session";
import { isCrmClientVisibleToScope, resolveCrmEmployeeScope } from "@/lib/crm-client-access";

export async function GET(_request: Request, { params }: { params: Promise<{ id: string }> }) {
  const session = await getCurrentSession();
  // CRM is agency-shared (no organizationId scoping — see db/schema.ts on
  // crmClients), so any signed-in staff/admin can fetch any CRM document;
  // clients (portal-only role) must not.
  if (!session || (session.context === "CLIENT" && session.role === "client")) {
    return new Response("Non autorisé", { status: 401 });
  }

  const { id } = await params;

  const [document] = await db.select().from(crmClientDocuments).where(eq(crmClientDocuments.id, id)).limit(1);
  if (!document) {
    return new Response("Document introuvable", { status: 404 });
  }

  // P0-2J — the check above only confirms "authenticated staff", never
  // that the targeted document's client belongs to an EMPLOYEE's own
  // assigned scope. scope === null (OWNER/ADMIN/MANAGER — unrestricted)
  // short-circuits here with zero extra query, exactly like
  // requireCrmClientAccess()'s own early return — only an EMPLOYEE scope
  // ever reaches the one extra, indexed lookup of the client's own
  // assignedUserId (isCrmClientVisibleToScope() compares against that,
  // never against crmClients.id itself). Deliberately the SAME
  // 404/message as the "document doesn't exist" branch above, never a
  // 403: a different status for "exists but out of scope" vs. "doesn't
  // exist" would itself leak whether the document exists at all.
  const scope = await resolveCrmEmployeeScope();
  if (scope !== null) {
    const [client] = await db.select({ assignedUserId: crmClients.assignedUserId }).from(crmClients).where(eq(crmClients.id, document.clientId)).limit(1);
    if (!isCrmClientVisibleToScope(scope, client?.assignedUserId ?? null)) {
      return new Response("Document introuvable", { status: 404 });
    }
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
