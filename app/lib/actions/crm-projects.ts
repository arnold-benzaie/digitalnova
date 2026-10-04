"use server";

import { and, eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { buildCrmEmployeeScopePredicate, requireCrmClientAccess, resolveCrmEmployeeScope } from "@/lib/crm-client-access";

const MESSAGES = {
  fr: {
    clientRequired: "Client requis.",
    clientNotFound: "Client introuvable.",
    nameRequired: "Nom du projet requis.",
    invalidStatus: "Statut invalide.",
    projectNotFound: "Projet introuvable.",
  },
  en: {
    clientRequired: "Client required.",
    clientNotFound: "Client not found.",
    nameRequired: "Project name required.",
    invalidStatus: "Invalid status.",
    projectNotFound: "Project not found.",
  },
} as const;

const STATUSES = ["planning", "in_progress", "completed", "on_hold"] as const;

export async function createProject(formData: FormData) {
  await requireStaffRole();
  const locale = await getLocale();
  const clientId = formData.get("clientId");
  const name = formData.get("name");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error(MESSAGES[locale].clientRequired);
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(MESSAGES[locale].nameRequired);
  }
  // P0-2F — an EMPLOYEE may only create a project for a client assigned to
  // them; OWNER/ADMIN/MANAGER (unrestricted scope) are unaffected. Same
  // SELECT-then-check primitive already used by lib/actions/crm-clients.ts's
  // own mutations — a prior check is the accepted pattern for CREATE, where
  // there is no WHERE clause to fold an atomic predicate into.
  await requireCrmClientAccess(clientId, new Error(MESSAGES[locale].clientNotFound));

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
  await requireStaffRole();
  const locale = await getLocale();
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error(MESSAGES[locale].invalidStatus);
  }

  const scope = await resolveCrmEmployeeScope();
  const [project] = await db
    .update(projects)
    .set({ status })
    .where(and(eq(projects.id, id), buildCrmEmployeeScopePredicate(scope, projects.clientId)))
    .returning();

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
  await requireStaffRole();
  const locale = await getLocale();
  const name = formData.get("name");
  if (typeof name !== "string" || !name.trim()) {
    throw new Error(MESSAGES[locale].nameRequired);
  }

  const startDateRaw = formData.get("startDate");
  const dueDateRaw = formData.get("dueDate");

  const scope = await resolveCrmEmployeeScope();
  const [project] = await db
    .update(projects)
    .set({
      name: name.trim(),
      description: (formData.get("description") as string) || null,
      startDate: typeof startDateRaw === "string" && startDateRaw ? new Date(startDateRaw) : null,
      dueDate: typeof dueDateRaw === "string" && dueDateRaw ? new Date(dueDateRaw) : null,
    })
    .where(and(eq(projects.id, id), buildCrmEmployeeScopePredicate(scope, projects.clientId)))
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
  await requireStaffRole();
  const locale = await getLocale();
  const scope = await resolveCrmEmployeeScope();
  const [project] = await db
    .delete(projects)
    .where(and(eq(projects.id, id), buildCrmEmployeeScopePredicate(scope, projects.clientId)))
    .returning();
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
