"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { tasks } from "@/db/schema";
import { logAudit } from "@/lib/audit";

const STATUSES = ["todo", "in_progress", "done"] as const;

export async function createTask(formData: FormData) {
  const title = formData.get("title");
  if (typeof title !== "string" || !title.trim()) {
    throw new Error("Titre requis.");
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

  await logAudit({
    action: "crm.task_created",
    targetType: "task",
    targetId: task.id,
    metadata: { title: task.title },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tasks");
  if (task.clientId) revalidatePath(`/admin/crm/clients/${task.clientId}`);
}

export async function updateTaskStatus(id: string, status: string) {
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error("Statut invalide.");
  }

  const [task] = await db.update(tasks).set({ status }).where(eq(tasks.id, id)).returning();

  await logAudit({
    action: "crm.task_status_changed",
    targetType: "task",
    targetId: id,
    metadata: { status },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tasks");
  if (task?.clientId) revalidatePath(`/admin/crm/clients/${task.clientId}`);
}
