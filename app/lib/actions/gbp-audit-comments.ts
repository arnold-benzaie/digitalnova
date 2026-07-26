"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpAuditComments } from "@/db/audit-schema";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { emptyComment: "Le commentaire ne peut pas être vide.", commentNotFound: "Ce commentaire est introuvable pour cet audit." },
  en: { emptyComment: "The comment cannot be empty.", commentNotFound: "This comment could not be found for this audit." },
} as const;

export async function addAuditComment(auditId: string, formData: FormData) {
  const [session, locale] = await Promise.all([requireAuditStaffRole(), getLocale()]);

  const body = String(formData.get("body") ?? "").trim();
  if (!body) throw new Error(MESSAGES[locale].emptyComment);

  const findingId = (formData.get("findingId") as string) || null;
  const authorName = session.fullName ?? session.email;

  const [comment] = await auditDb.insert(gbpAuditComments).values({ auditId, findingId, authorName, body }).returning();

  await logAuditActivity({ action: "comment_added", targetType: "gbp_audit_comments", targetId: comment.id, metadata: { auditId } });
  revalidatePath(`/admin/audit/${auditId}`);
  return comment;
}

export async function deleteAuditComment(commentId: string, auditId: string) {
  const [, locale] = await Promise.all([requireAuditStaffRole(), getLocale()]);
  const { rowCount } = await auditDb.delete(gbpAuditComments).where(and(eq(gbpAuditComments.id, commentId), eq(gbpAuditComments.auditId, auditId)));
  if (rowCount === 0) throw new Error(MESSAGES[locale].commentNotFound);
  await logAuditActivity({ action: "comment_deleted", targetType: "gbp_audit_comments", targetId: commentId, metadata: { auditId } });
  revalidatePath(`/admin/audit/${auditId}`);
}
