"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpCorrectionTasks } from "@/db/audit-schema";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { dispatchAuditWebhookEvent } from "@/lib/gbp-audit/webhooks";
import { GBP_SEVERITIES } from "@/lib/gbp-audit/checklist";

const PHASES = [1, 2, 3];
const TASK_STATUSES = ["todo", "in_progress", "done"] as const;
const DIFFICULTIES = ["low", "medium", "high"] as const;

function parsePriority(formData: FormData): string {
  const value = (formData.get("priority") as string) || "moderate";
  return (GBP_SEVERITIES as readonly string[]).includes(value) ? value : "moderate";
}

function parseDifficulty(formData: FormData): string {
  const value = (formData.get("difficulty") as string) || "medium";
  return (DIFFICULTIES as readonly string[]).includes(value) ? value : "medium";
}

function parseEtaDays(formData: FormData): number | null {
  const raw = formData.get("etaDays");
  if (!raw) return null;
  const parsed = parseInt(String(raw), 10);
  if (!Number.isFinite(parsed)) return null;
  return Math.max(0, parsed);
}

export async function createCorrectionTask(formData: FormData) {
  await requireAuditStaffRole();

  const auditId = String(formData.get("auditId") ?? "");
  const title = String(formData.get("title") ?? "").trim();
  if (!auditId || !title) throw new Error("Titre et audit requis.");

  const phase = PHASES.includes(Number(formData.get("phase"))) ? Number(formData.get("phase")) : 1;

  const [task] = await auditDb
    .insert(gbpCorrectionTasks)
    .values({
      auditId,
      title,
      phase,
      priority: parsePriority(formData),
      difficulty: parseDifficulty(formData),
      ownerName: (formData.get("ownerName") as string) || null,
      etaDays: parseEtaDays(formData),
      findingId: (formData.get("findingId") as string) || null,
      recommendedServiceOfferId: (formData.get("recommendedServiceOfferId") as string) || null,
    })
    .returning();

  await logAuditActivity({ action: "correction_task_created", targetType: "gbp_correction_task", targetId: task.id, metadata: { auditId, phase, title } });
  revalidatePath(`/admin/audit/${auditId}/plan-correction`);
  return task;
}

export async function updateCorrectionTask(taskId: string, auditId: string, formData: FormData) {
  await requireAuditStaffRole();

  const title = String(formData.get("title") ?? "").trim();
  if (!title) throw new Error("Le titre est requis.");

  const { rowCount } = await auditDb
    .update(gbpCorrectionTasks)
    .set({
      title,
      priority: parsePriority(formData),
      difficulty: parseDifficulty(formData),
      ownerName: (formData.get("ownerName") as string) || null,
      etaDays: parseEtaDays(formData),
      recommendedServiceOfferId: (formData.get("recommendedServiceOfferId") as string) || null,
    })
    .where(and(eq(gbpCorrectionTasks.id, taskId), eq(gbpCorrectionTasks.auditId, auditId)));
  if (rowCount === 0) throw new Error("Cette action est introuvable pour cet audit.");

  await logAuditActivity({ action: "correction_task_updated", targetType: "gbp_correction_task", targetId: taskId, metadata: { auditId, title } });
  revalidatePath(`/admin/audit/${auditId}/plan-correction`);
}

export async function updateCorrectionTaskStatus(taskId: string, auditId: string, status: string) {
  await requireAuditStaffRole();
  if (!TASK_STATUSES.includes(status as (typeof TASK_STATUSES)[number])) throw new Error("Statut invalide.");

  const { rowCount } = await auditDb
    .update(gbpCorrectionTasks)
    .set({ status })
    .where(and(eq(gbpCorrectionTasks.id, taskId), eq(gbpCorrectionTasks.auditId, auditId)));
  if (rowCount === 0) throw new Error("Cette action est introuvable pour cet audit.");

  await logAuditActivity({ action: "correction_task_status_changed", targetType: "gbp_correction_task", targetId: taskId, metadata: { auditId, status } });
  await dispatchAuditWebhookEvent("gbp_audit.correction_task_status_changed", { taskId, auditId, status });
  revalidatePath(`/admin/audit/${auditId}/plan-correction`);
}

export async function deleteCorrectionTask(taskId: string, auditId: string) {
  await requireAuditStaffRole();
  const { rowCount } = await auditDb.delete(gbpCorrectionTasks).where(and(eq(gbpCorrectionTasks.id, taskId), eq(gbpCorrectionTasks.auditId, auditId)));
  if (rowCount === 0) throw new Error("Cette action est introuvable pour cet audit.");
  revalidatePath(`/admin/audit/${auditId}/plan-correction`);
}
