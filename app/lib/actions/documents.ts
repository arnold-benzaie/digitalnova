"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { documents } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { getDevRole } from "@/lib/dev-role";
import { getOrCreateDevOrganization } from "@/lib/dev-org";
import { notify } from "@/lib/notifications";

const MAX_SIZE_BYTES = 4 * 1024 * 1024; // 4MB — see next.config.ts bodySizeLimit

export async function uploadDocument(formData: FormData) {
  const file = formData.get("file");
  if (!(file instanceof File) || file.size === 0) {
    throw new Error("Sélectionnez un fichier.");
  }
  if (file.size > MAX_SIZE_BYTES) {
    throw new Error("Fichier trop volumineux (4 Mo maximum).");
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
    title: "Nouveau document ajouté",
    body: file.name,
  });

  revalidatePath("/dashboard/documents");
  revalidatePath("/dashboard/notifications");
  revalidatePath("/admin/notifications");
}

export async function deleteDocument(id: string) {
  const org = await getOrCreateDevOrganization();
  await db.delete(documents).where(eq(documents.id, id));

  await logAudit({
    organizationId: org.id,
    action: "document.deleted",
    targetType: "document",
    targetId: id,
  });

  revalidatePath("/dashboard/documents");
}
