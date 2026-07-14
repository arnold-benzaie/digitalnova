import { asc, desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, tasks } from "@/db/schema";
import { TASK_STATUS_OPTIONS } from "@/components/crm/badges";
import { CreateTaskForm } from "@/components/crm/create-task-form";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { updateTaskStatus } from "@/lib/actions/crm-tasks";
import { requireStaffRole } from "@/lib/dev-role";

export default async function CrmTasksPage() {
  await requireStaffRole();

  const [allTasks, allClients] = await Promise.all([
    db.select().from(tasks).orderBy(desc(tasks.createdAt)),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Tâches</h1>
      <p className="mt-2 text-sm text-pm-gris">{allTasks.length} tâche(s).</p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <CreateTaskForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      {allTasks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucune tâche</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {allTasks.map((task) => (
            <div key={task.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div>
                <p className="font-medium text-pm-noir">{task.title}</p>
                <p className="text-xs text-pm-gris">
                  {task.clientId ? (
                    <Link href={`/admin/crm/clients/${task.clientId}`} className="hover:underline">
                      {clientNameById.get(task.clientId) ?? "—"}
                    </Link>
                  ) : (
                    "Interne"
                  )}
                  {task.assignee ? ` · ${task.assignee}` : ""}
                  {task.dueDate ? ` · échéance ${new Date(task.dueDate).toLocaleDateString("fr-FR")}` : ""}
                </p>
              </div>
              <InlineStatusSelect value={task.status} options={TASK_STATUS_OPTIONS} action={updateTaskStatus.bind(null, task.id)} />
            </div>
          ))}
        </div>
      )}
    </>
  );
}
