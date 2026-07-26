"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { titleRequired: "Titre requis.", invalidStatus: "Statut invalide.", taskNotFound: "Tâche introuvable." },
  en: { titleRequired: "Title required.", invalidStatus: "Invalid status.", taskNotFound: "Task not found." },
} as const;

const STATUSES = ["todo", "in_progress", "done"] as const;

export async function createTask(formData: FormData) {
  const locale = await getLocale();
  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error(MESSAGES[locale].titleRequired);
  }

  const clientId = formData.get("clientId");
  const dueDateRaw = formData.get("dueDate");

  const [task] = await db
    .insert(tasks)
    .values({
      title: title.trim(),
      description: (formData.get("description") as string) || null,
      clientId: typeof clientId === "string" && clientId ? clientId : null,
      dueDate: typeof dueDateRaw === "string" && dueDateRaw ? new Date(dueDateRaw) : null,
      assignee: (formData.get("assignee") as string) || null,
    })
    .returning();

  await logCrmAudit({
    action: "crm.task_created",
    targetType: "task",
    targetId: task.id,
    clientId: task.clientId ?? undefined,
    metadata: { title: task.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tasks");
  if (task.clientId) revalidatePath(`/admin/crm/clients/${task.clientId}`);
}

export async function updateTaskStatus(id: string, status: string) {
  const locale = await getLocale();
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error(MESSAGES[locale].invalidStatus);
  }

  const [task] = await db.update(tasks).set({ status }).where(eq(tasks.id, id)).returning();

  await logCrmAudit({
    action: "crm.task_status_changed",
    targetType: "task",
    targetId: id,
    clientId: task?.clientId ?? undefined,
    metadata: { status },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tasks");
  if (task?.clientId) revalidatePath(`/admin/crm/clients/${task.clientId}`);
}

/** Full edit — title/description/assignee/due date; use updateTaskStatus for status. */
export async function updateTask(id: string, formData: FormData) {
  const locale = await getLocale();
  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error(MESSAGES[locale].titleRequired);
  }

  const dueDateRaw = formData.get("dueDate");

  const [task] = await db
    .update(tasks)
    .set({
      title: title.trim(),
      description: (formData.get("description") as string) || null,
      assignee: (formData.get("assignee") as string) || null,
      dueDate: typeof dueDateRaw === "string" && dueDateRaw ? new Date(dueDateRaw) : null,
    })
    .where(eq(tasks.id, id))
    .returning();
  if (!task) throw new Error(MESSAGES[locale].taskNotFound);

  await logCrmAudit({
    action: "crm.task_updated",
    targetType: "task",
    targetId: id,
    clientId: task.clientId ?? undefined,
    metadata: { title: task.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tasks");
  if (task.clientId) revalidatePath(`/admin/crm/clients/${task.clientId}`);
  return task;
}

export async function deleteTask(id: string) {
  const locale = await getLocale();
  const [task] = await db.delete(tasks).where(eq(tasks.id, id)).returning();
  if (!task) throw new Error(MESSAGES[locale].taskNotFound);

  await logCrmAudit({
    action: "crm.task_deleted",
    targetType: "task",
    targetId: id,
    clientId: task.clientId ?? undefined,
    metadata: { title: task.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tasks");
  if (task.clientId) revalidatePath(`/admin/crm/clients/${task.clientId}`);
}
