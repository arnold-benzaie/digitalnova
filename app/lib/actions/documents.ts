"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getDevRole } from "@/lib/dev-role";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { notify } from "@/lib/notifications";
import { getLocale } from "@/lib/i18n/locale";

const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4MB — see next.config.ts bodySizeLimit

const MESSAGES = {
  fr: { selectFile: "Sélectionnez un fichier.", fileTooLarge: "Fichier trop volumineux (4 Mo maximum).", documentNotFound: "Document introuvable." },
  en: { selectFile: "Select a file.", fileTooLarge: "File too large (4 MB maximum).", documentNotFound: "Document not found." },
} as const;

export async function uploadDocument(formData: FormData) {
  const locale = await getLocale();
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error(MESSAGES[locale].selectFile);
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error(MESSAGES[locale].fileTooLarge);
  }

  const org = await getOrCreateDevOrganization();
  const role = await getDevRole();
  const buffer = Buffer.from(await file.arrayBuffer());

  await db.insert(documents).values({
    organizationId: org.id,
    fileName: file.name,
    mimeType: file.type || "application/octet-stream",
    sizeBytes: file.size,
    content: buffer.toString("base64"),
    uploadedByRole: role === "client" ? "client" : "staff",
  });

  await logAudit({
    organizationId: org.id,
    action: "document.uploaded",
    targetType: "document",
    targetId: file.name,
    metadata: { sizeBytes: file.size },
  });

  await notify({
    organizationId: org.id,
    type: "document.uploaded",
    metadata: {},
    rawBody: file.name,
  });

  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}

export async function deleteDocument(id: string) {
  const [org, locale] = await Promise.all([getOrCreateDevOrganization(), getLocale()]);
  const [deleted] = await db
    .delete(documents)
    .where(and(eq(documents.id, id), eq(documents.organizationId, org.id)))
    .returning({ id: documents.id });
  if (!deleted) {
    // Either it never existed, or it belongs to a different organization —
    // don't distinguish the two in the error, same as a 404 would.
    throw new Error(MESSAGES[locale].documentNotFound);
  }

  await logAudit({
    organizationId: org.id,
    action: "document.deleted",
    targetType: "document",
    targetId: id,
  });

  revalidatePath("/dashboard/documents");
}
