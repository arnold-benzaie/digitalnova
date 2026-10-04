"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClientDocuments } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { requireStaffRole } from "@/lib/dev-role";
import { getCurrentSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";
import { buildCrmEmployeeScopePredicate, requireCrmClientAccess, resolveCrmEmployeeScope } from "@/lib/crm-client-access";

const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4MB — see next.config.ts bodySizeLimit

const MESSAGES = {
  fr: {
    clientRequired: "Client requis.",
    clientNotFound: "Client introuvable.",
    selectFile: "Sélectionnez un fichier.",
    fileTooLarge: "Fichier trop volumineux (4 Mo maximum).",
    documentNotFound: "Document introuvable.",
  },
  en: {
    clientRequired: "Client required.",
    clientNotFound: "Client not found.",
    selectFile: "Select a file.",
    fileTooLarge: "File too large (4 MB maximum).",
    documentNotFound: "Document not found.",
  },
} as const;

export async function uploadCrmDocument(formData: FormData) {
  // P0-1 security fix: a page-level requireStaffRole() gate does not
  // extend to this Server Action — Next.js exposes every exported action
  // as its own directly-POSTable entry point regardless of which page
  // rendered the UI that calls it (see node_modules/next/dist/docs/01-app/
  // 02-guides/data-security.md). This action now re-verifies the caller
  // itself, the same helper already used at the top of the CRM pages that
  // render this upload form, and the same pattern already applied to
  // updateQuoteStatus/convertQuoteToInvoice below in crm-quotes.ts.
  await requireStaffRole();

  const locale = await getLocale();
  const clientId = formData.get("clientId");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error(MESSAGES[locale].clientRequired);
  }
  // P0-2I — requireStaffRole() above (P0-1) only confirms "authenticated
  // staff"; it does not verify the targeted client belongs to the
  // EMPLOYEE's own assigned scope. Checked before any DB write (there is
  // no separate storage upload here — content is embedded directly in
  // the DB row). Same CREATE-pattern primitive already used by
  // createProject/createWebsite/createInteraction. OWNER/ADMIN/MANAGER
  // (unrestricted scope) are unaffected.
  await requireCrmClientAccess(clientId, new Error(MESSAGES[locale].clientNotFound));

  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error(MESSAGES[locale].selectFile);
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(MESSAGES[locale].fileTooLarge);
  }

  const session = await getCurrentSession();
  const buffer = Buffer.from(await file.arrayBuffer());

  const [document] = await db
    .insert(crmClientDocuments)
    .values({
      clientId,
      fileName: file.name,
      mimeType: file.type || "application/octet-stream",
      sizeBytes: file.size,
      content: buffer.toString("base64"),
      uploadedBy: session?.fullName ?? session?.email ?? null,
    })
    .returning();

  await logCrmAudit({
    action: "crm.document_uploaded",
    targetType: "crm_client_document",
    targetId: document.id,
    clientId,
    metadata: { fileName: file.name },
  });

  revalidatePath(`/admin/crm/clients/${clientId}`);
}

export async function deleteCrmDocument(id: string) {
  // P0-1 security fix: see uploadCrmDocument's identical comment above.
  await requireStaffRole();

  const locale = await getLocale();
  // P0-2I — the scope check is folded directly into this DELETE's own
  // WHERE clause (atomic, single statement) rather than a separate
  // SELECT-then-check: an EMPLOYEE outside their scope matches zero
  // rows, indistinguishable from a genuinely nonexistent id, with no
  // TOCTOU window between checking and mutating. The pre-existing
  // `if (!deleted) throw` guard below already covers this case correctly
  // — no further change needed there.
  const scope = await resolveCrmEmployeeScope();
  const [deleted] = await db
    .delete(crmClientDocuments)
    .where(and(eq(crmClientDocuments.id, id), buildCrmEmployeeScopePredicate(scope, crmClientDocuments.clientId)))
    .returning();
  if (!deleted) throw new Error(MESSAGES[locale].documentNotFound);

  await logCrmAudit({
    action: "crm.document_deleted",
    targetType: "crm_client_document",
    targetId: id,
    clientId: deleted.clientId,
    metadata: { fileName: deleted.fileName },
  });

  revalidatePath(`/admin/crm/clients/${deleted.clientId}`);
}
