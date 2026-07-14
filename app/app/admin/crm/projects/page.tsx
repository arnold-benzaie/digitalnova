import { asc, desc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, projects } from "@/db/schema";
import { PROJECT_STATUS_OPTIONS } from "@/components/crm/badges";
import { CreateProjectForm } from "@/components/crm/create-project-form";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { updateProjectStatus } from "@/lib/actions/crm-projects";
import { requireStaffRole } from "@/lib/dev-role";

export default async function CrmProjectsPage() {
  await requireStaffRole();

  const [allProjects, allClients] = await Promise.all([
    db.select().from(projects).orderBy(desc(projects.createdAt)),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Projets</h1>
      <p className="mt-2 text-sm text-pm-gris">{allProjects.length} projet(s) de livraison en cours ou planifiés.</p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <CreateProjectForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      {allProjects.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucun projet</p>
        </div>
      ) : (
        <div className="mt-6 flex flex-col gap-3">
          {allProjects.map((project) => (
            <div key={project.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
              <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                <div>
                  <Link href={`/admin/crm/clients/${project.clientId}`} className="font-medium text-pm-noir hover:underline">
                    {project.name}
                  </Link>
                  <p className="text-xs text-pm-gris">
                    {clientNameById.get(project.clientId) ?? "—"}
                    {project.dueDate ? ` · échéance ${new Date(project.dueDate).toLocaleDateString("fr-FR")}` : ""}
                  </p>
                </div>
                <InlineStatusSelect value={project.status} options={PROJECT_STATUS_OPTIONS} action={updateProjectStatus.bind(null, project.id)} />
              </div>
              {project.description && <p className="mt-2 text-sm text-pm-gris">{project.description}</p>}
            </div>
          ))}
        </div>
      )}
    </>
  );
}
