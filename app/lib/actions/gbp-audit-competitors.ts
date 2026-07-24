"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { auditBusinesses, gbpAudits, gbpCompetitors } from "@/db/audit-schema";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";

const MAX_COMPETITORS = 5; // spec §8.R — "jusqu'à cinq concurrents"

/** Ratings are stored as basis points (450 = 4.5) so comparisons stay integer math — see competitor-scoring.ts. Clamped 0–500 regardless of what the client sends, since the HTML min/max on the input is not a server guarantee. */
function clampRating(raw: FormDataEntryValue | null): number | null {
  if (!raw) return null;
  const parsed = Math.round(parseFloat(String(raw)) * 100);
  if (!Number.isFinite(parsed)) return null;
  return Math.min(500, Math.max(0, parsed));
}

function clampCount(raw: FormDataEntryValue | null): number | null {
  if (!raw) return null;
  const parsed = parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

function parseCompetitorFields(formData: FormData) {
  return {
    googleProfileUrl: (formData.get("googleProfileUrl") as string) || null,
    rating: clampRating(formData.get("rating")),
    reviewCount: clampCount(formData.get("reviewCount")),
    photoCount: clampCount(formData.get("photoCount")),
    postsRecent: formData.get("postsRecent") === "on",
    notes: (formData.get("notes") as string) || null,
  };
}

export async function addCompetitor(formData: FormData) {
  await requireAuditStaffRole();

  const auditId = String(formData.get("auditId") ?? "");
  const name = String(formData.get("name") ?? "").trim();
  if (!auditId || !name) throw new Error("Nom du concurrent et audit requis.");

  const existing = await auditDb.select({ id: gbpCompetitors.id }).from(gbpCompetitors).where(eq(gbpCompetitors.auditId, auditId));
  if (existing.length >= MAX_COMPETITORS) {
    throw new Error(`Maximum ${MAX_COMPETITORS} concurrents par audit.`);
  }

  const [competitor] = await auditDb
    .insert(gbpCompetitors)
    .values({ auditId, name, ...parseCompetitorFields(formData) })
    .returning();

  await logAuditActivity({ action: "competitor_added", targetType: "gbp_competitor", targetId: competitor.id, metadata: { auditId, name } });
  revalidatePath(`/admin/audit/${auditId}/concurrence`);
  return competitor;
}

export async function updateCompetitor(competitorId: string, auditId: string, formData: FormData) {
  await requireAuditStaffRole();

  const name = String(formData.get("name") ?? "").trim();
  if (!name) throw new Error("Le nom du concurrent est requis.");

  const { rowCount } = await auditDb
    .update(gbpCompetitors)
    .set({ name, ...parseCompetitorFields(formData) })
    .where(and(eq(gbpCompetitors.id, competitorId), eq(gbpCompetitors.auditId, auditId)));
  if (rowCount === 0) throw new Error("Ce concurrent est introuvable pour cet audit.");

  await logAuditActivity({ action: "competitor_updated", targetType: "gbp_competitor", targetId: competitorId, metadata: { auditId, name } });
  revalidatePath(`/admin/audit/${auditId}/concurrence`);
}

export async function deleteCompetitor(competitorId: string, auditId: string) {
  await requireAuditStaffRole();
  const { rowCount } = await auditDb.delete(gbpCompetitors).where(and(eq(gbpCompetitors.id, competitorId), eq(gbpCompetitors.auditId, auditId)));
  if (rowCount === 0) throw new Error("Ce concurrent est introuvable pour cet audit.");
  revalidatePath(`/admin/audit/${auditId}/concurrence`);
}

export async function updateBusinessProfileStats(businessId: string, auditId: string, formData: FormData) {
  await requireAuditStaffRole();

  // businessId has no direct auditId column (auditBusinesses is referenced
  // BY gbpAudits, not the reverse) — confirm the given businessId is
  // actually the one this auditId points to before writing.
  const [audit] = await auditDb.select({ businessId: gbpAudits.businessId }).from(gbpAudits).where(eq(gbpAudits.id, auditId)).limit(1);
  if (!audit || audit.businessId !== businessId) throw new Error("Cette entreprise ne correspond pas à cet audit.");

  await auditDb
    .update(auditBusinesses)
    .set({
      currentRating: clampRating(formData.get("currentRating")),
      currentReviewCount: clampCount(formData.get("currentReviewCount")),
      currentPhotoCount: clampCount(formData.get("currentPhotoCount")),
      postsRecent: formData.get("postsRecent") === "on",
    })
    .where(eq(auditBusinesses.id, businessId));

  await logAuditActivity({ action: "business_profile_stats_updated", targetType: "audit_businesses", targetId: businessId, metadata: { auditId } });
  revalidatePath(`/admin/audit/${auditId}/concurrence`);
}
