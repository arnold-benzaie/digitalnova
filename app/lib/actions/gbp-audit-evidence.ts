"use server";

import { randomUUID } from "node:crypto";
import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpAuditEvidence, gbpAuditFindings } from "@/db/audit-schema";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { AUDIT_STORAGE_BUCKETS, deleteFromAuditBucket, uploadToAuditBucket } from "@/lib/gbp-audit/storage";
import { getLocale } from "@/lib/i18n/locale";
import type { Locale } from "@/lib/i18n/dictionaries";

const MAX_FILE_BYTES = 8 * 1024 * 1024; // 8MB — generous for a screenshot/PDF
const ALLOWED_MIME = ["image/png", "image/jpeg", "image/webp", "application/pdf"];
const EVIDENCE_KINDS = ["screenshot", "photo", "pdf", "link", "note"] as const;

const MESSAGES = {
  fr: {
    findingNotFound: "Constat introuvable.",
    findingMissing: "Constat manquant.",
    invalidEvidenceType: "Type de preuve invalide.",
    linkRequired: "Un lien est requis pour ce type de preuve.",
    noteRequired: "Une note est requise pour ce type de preuve.",
    noFileProvided: "Aucun fichier fourni.",
    fileTooLarge: "Fichier trop volumineux (8 Mo maximum).",
    formatNotAllowed: "Format non autorisé (PNG, JPEG, WEBP ou PDF uniquement).",
    evidenceNotFound: "Cette preuve est introuvable pour cet audit.",
  },
  en: {
    findingNotFound: "Finding not found.",
    findingMissing: "Finding missing.",
    invalidEvidenceType: "Invalid evidence type.",
    linkRequired: "A link is required for this evidence type.",
    noteRequired: "A note is required for this evidence type.",
    noFileProvided: "No file provided.",
    fileTooLarge: "File too large (8 MB maximum).",
    formatNotAllowed: "Format not allowed (PNG, JPEG, WEBP, or PDF only).",
    evidenceNotFound: "This evidence could not be found for this audit.",
  },
} as const;

async function findingAuditId(findingId: string, locale: Locale): Promise<string> {
  const [row] = await auditDb.select({ auditId: gbpAuditFindings.auditId }).from(gbpAuditFindings).where(eq(gbpAuditFindings.id, findingId)).limit(1);
  if (!row) throw new Error(MESSAGES[locale].findingNotFound);
  return row.auditId;
}

/** Strips path separators and control characters — the result is used as part of a Storage object path, not a filesystem path, but keep it boring regardless. */
function sanitizeFileName(name: string): string {
  return name.replace(/[^a-zA-Z0-9._-]/g, "_").slice(-120);
}

export async function addEvidenceFile(formData: FormData) {
  const [, locale] = await Promise.all([requireAuditStaffRole(), getLocale()]);

  const findingId = String(formData.get("findingId") ?? "");
  if (!findingId) throw new Error(MESSAGES[locale].findingMissing);
  const auditId = await findingAuditId(findingId, locale);

  const kind = String(formData.get("kind") ?? "screenshot");
  if (!EVIDENCE_KINDS.includes(kind as (typeof EVIDENCE_KINDS)[number])) throw new Error(MESSAGES[locale].invalidEvidenceType);

  const note = (formData.get("note") as string) || null;

  if (kind === "link") {
    const url = (formData.get("url") as string) || "";
    if (!url.trim()) throw new Error(MESSAGES[locale].linkRequired);
    const [evidence] = await auditDb.insert(gbpAuditEvidence).values({ findingId, kind, url: url.trim(), note }).returning();
    await afterEvidenceAdded(evidence.id, findingId, auditId, kind);
    return evidence;
  }

  if (kind === "note") {
    if (!note?.trim()) throw new Error(MESSAGES[locale].noteRequired);
    const [evidence] = await auditDb.insert(gbpAuditEvidence).values({ findingId, kind, note }).returning();
    await afterEvidenceAdded(evidence.id, findingId, auditId, kind);
    return evidence;
  }

  const file = formData.get("file");
  if (!(file instanceof File)) throw new Error(MESSAGES[locale].noFileProvided);
  if (file.size > MAX_FILE_BYTES) throw new Error(MESSAGES[locale].fileTooLarge);
  if (!ALLOWED_MIME.includes(file.type)) throw new Error(MESSAGES[locale].formatNotAllowed);

  const buffer = Buffer.from(await file.arrayBuffer());
  const storagePath = `${findingId}/${randomUUID()}-${sanitizeFileName(file.name)}`;
  await uploadToAuditBucket(AUDIT_STORAGE_BUCKETS.evidence, storagePath, buffer, file.type);

  const [evidence] = await auditDb
    .insert(gbpAuditEvidence)
    .values({
      findingId,
      kind,
      fileName: file.name,
      mimeType: file.type,
      sizeBytes: file.size,
      storageBucket: AUDIT_STORAGE_BUCKETS.evidence,
      storagePath,
      note,
    })
    .returning();

  await afterEvidenceAdded(evidence.id, findingId, auditId, kind);
  return { id: evidence.id, kind: evidence.kind, fileName: evidence.fileName };
}

async function afterEvidenceAdded(evidenceId: string, findingId: string, auditId: string, kind: string) {
  await logAuditActivity({
    action: "evidence_added",
    targetType: "gbp_audit_evidence",
    targetId: evidenceId,
    metadata: { auditId, findingId, kind },
  });
  revalidatePath(`/admin/audit/${auditId}`);
  revalidatePath(`/admin/audit/${auditId}/audit`);
  revalidatePath(`/admin/audit/${auditId}/preuves`);
}

export async function deleteEvidence(evidenceId: string, auditId: string) {
  const [, locale] = await Promise.all([requireAuditStaffRole(), getLocale()]);

  const [row] = await auditDb
    .select({ storageBucket: gbpAuditEvidence.storageBucket, storagePath: gbpAuditEvidence.storagePath })
    .from(gbpAuditEvidence)
    .innerJoin(gbpAuditFindings, eq(gbpAuditEvidence.findingId, gbpAuditFindings.id))
    .where(and(eq(gbpAuditEvidence.id, evidenceId), eq(gbpAuditFindings.auditId, auditId)))
    .limit(1);
  if (!row) throw new Error(MESSAGES[locale].evidenceNotFound);

  await auditDb.delete(gbpAuditEvidence).where(eq(gbpAuditEvidence.id, evidenceId));

  if (row?.storageBucket && row.storagePath) {
    await deleteFromAuditBucket(row.storageBucket as (typeof AUDIT_STORAGE_BUCKETS)[keyof typeof AUDIT_STORAGE_BUCKETS], row.storagePath);
  }

  await logAuditActivity({ action: "evidence_deleted", targetType: "gbp_audit_evidence", targetId: evidenceId, metadata: { auditId } });
  revalidatePath(`/admin/audit/${auditId}`);
  revalidatePath(`/admin/audit/${auditId}/audit`);
  revalidatePath(`/admin/audit/${auditId}/preuves`);
}

export async function markEvidenceVerified(evidenceId: string, auditId: string) {
  await requireAuditStaffRole();
  await auditDb.update(gbpAuditEvidence).set({ verifiedAt: new Date() }).where(eq(gbpAuditEvidence.id, evidenceId));
  revalidatePath(`/admin/audit/${auditId}/preuves`);
}
