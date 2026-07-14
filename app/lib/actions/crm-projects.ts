"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { projects } from "@/db/schema";
import { logAudit } from "@/lib/audit";

const STATUSES = ["planning", "in_progress", "completed", "on_hold"] as const;

export async function createProject(formData: FormData) {
  const clientId = formData.get("clientId");
  const name = formData.get("name");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error("Client requis.");
  }
  if (typeof name !== "string" || !name.trim()) {
    throw new Error("Nom du projet requis.");
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

  await logAudit({
    action: "crm.project_created",
    targetType: "project",
    targetId: project.id,
    metadata: { name: project.name },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/projects");
  revalidatePath(`/admin/crm/clients/${clientId}`);
}

export async function updateProjectStatus(id: string, status: string) {
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error("Statut invalide.");
  }

  const [project] = await db.update(projects).set({ status }).where(eq(projects.id, id)).returning();

  await logAudit({
    action: "crm.project_status_changed",
    targetType: "project",
    targetId: id,
    metadata: { status },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/projects");
  if (project) revalidatePath(`/admin/crm/clients/${project.clientId}`);
}
