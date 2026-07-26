"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { clientRequired: "Client requis.", nameRequired: "Nom du projet requis.", invalidStatus: "Statut invalide.", projectNotFound: "Projet introuvable." },
  en: { clientRequired: "Client required.", nameRequired: "Project name required.", invalidStatus: "Invalid status.", projectNotFound: "Project not found." },
} as const;

const STATUSES = ["planning", "in_progress", "completed", "on_hold"] as const;

export async function createProject(formData: FormData) {
  const locale = await getLocale();
  const clientId = formData.get("clientId");
  const name = formData.get("name");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error(MESSAGES[locale].clientRequired);
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(MESSAGES[locale].nameRequired);
  }

  const dueDateRaw = formData.get("dueDate");

  const [project] = await db
    .insert(projects)
    .values({
      clientId,
      name: name.trim(),
      description: (formData.get("description") as string) || null,
      dueDate: typeof dueDateRaw === "string" && dueDateRaw ? new Date(dueDateRaw) : null,
    })
    .returning();

  await logCrmAudit({
    action: "crm.project_created",
    targetType: "project",
    targetId: project.id,
    clientId,
    metadata: { name: project.name },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/projects");
  revalidatePath(`/admin/crm/clients/${clientId}`);
}

export async function updateProjectStatus(id: string, status: string) {
  const locale = await getLocale();
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error(MESSAGES[locale].invalidStatus);
  }

  const [project] = await db.update(projects).set({ status }).where(eq(projects.id, id)).returning();

  await logCrmAudit({
    action: "crm.project_status_changed",
    targetType: "project",
    targetId: id,
    clientId: project?.clientId,
    metadata: { status },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/projects");
  if (project) revalidatePath(`/admin/crm/clients/${project.clientId}`);
}

/** Full edit — name/description/dates; use updateProjectStatus for status. */
export async function updateProject(id: string, formData: FormData) {
  const locale = await getLocale();
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(MESSAGES[locale].nameRequired);
  }

  const startDateRaw = formData.get("startDate");
  const dueDateRaw = formData.get("dueDate");

  const [project] = await db
    .update(projects)
    .set({
      name: name.trim(),
      description: (formData.get("description") as string) || null,
      startDate: typeof startDateRaw === "string" && startDateRaw ? new Date(startDateRaw) : null,
      dueDate: typeof dueDateRaw === "string" && dueDateRaw ? new Date(dueDateRaw) : null,
    })
    .where(eq(projects.id, id))
    .returning();
  if (!project) throw new Error(MESSAGES[locale].projectNotFound);

  await logCrmAudit({
    action: "crm.project_updated",
    targetType: "project",
    targetId: id,
    clientId: project.clientId,
    metadata: { name: project.name },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/projects");
  revalidatePath(`/admin/crm/clients/${project.clientId}`);
  return project;
}

export async function deleteProject(id: string) {
  const locale = await getLocale();
  const [project] = await db.delete(projects).where(eq(projects.id, id)).returning();
  if (!project) throw new Error(MESSAGES[locale].projectNotFound);

  await logCrmAudit({
    action: "crm.project_deleted",
    targetType: "project",
    targetId: id,
    clientId: project.clientId,
    metadata: { name: project.name },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/projects");
  revalidatePath(`/admin/crm/clients/${project.clientId}`);
}
