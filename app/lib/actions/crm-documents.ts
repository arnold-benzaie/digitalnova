"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClientDocuments } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { getCurrentSession } from "@/lib/session";
import { getLocale } from "@/lib/i18n/locale";

const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4MB — see next.config.ts bodySizeLimit

const MESSAGES = {
  fr: { clientRequired: "Client requis.", selectFile: "Sélectionnez un fichier.", fileTooLarge: "Fichier trop volumineux (4 Mo maximum).", documentNotFound: "Document introuvable." },
  en: { clientRequired: "Client required.", selectFile: "Select a file.", fileTooLarge: "File too large (4 MB maximum).", documentNotFound: "Document not found." },
} as const;

export async function uploadCrmDocument(formData: FormData) {
  const locale = await getLocale();
  const clientId = formData.get("clientId");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error(MESSAGES[locale].clientRequired);
  }

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
  const locale = await getLocale();
  const [deleted] = await db.delete(crmClientDocuments).where(eq(crmClientDocuments.id, id)).returning();
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
