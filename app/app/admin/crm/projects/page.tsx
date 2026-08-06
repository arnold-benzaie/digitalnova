import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, projects } from "@/db/schema";
import { PROJECT_STATUS_OPTIONS, getProjectStatusOptions } from "@/components/crm/badges";
import { CreateProjectForm } from "@/components/crm/create-project-form";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { DeleteProjectButton, EditProjectForm } from "@/components/crm/project-actions";
import { updateProjectStatus } from "@/lib/actions/crm-projects";
import { requireStaffRole } from "@/lib/dev-role";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";

const STATUS_VALUES = PROJECT_STATUS_OPTIONS.map((o) => o.value);
const PAGE_SIZE = 20;

type Params = { q?: string; status?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/crm/projects?${qs}` : "/admin/crm/projects";
}

export default async function CrmProjectsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const t = dictionaries[locale].crm.projects;
  const projectStatusOptions = getProjectStatusOptions(locale);

  const q = params.q?.trim() ?? "";
  const status = params.status && STATUS_VALUES.includes(params.status) ? params.status : "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) conditions.push(ilike(projects.name, `%${q}%`));
  if (status) conditions.push(eq(projects.status, status));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [allProjects, allClients, [{ count: totalCount }], [{ count: overallCount }]] = await Promise.all([
    db
      .select()
      .from(projects)
      .where(whereClause)
      .orderBy(desc(projects.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
    db.select({ count: sql<number>`count(*)::int` }).from(projects).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(projects),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || status);

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.resultsSummary(totalCount, overallCount, hasFilters)} />

      <div className={`mt-6 ${panelClass}`}>
        <CreateProjectForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} locale={locale} />
      </div>

      <form action="/admin/crm/projects" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder={t.searchPlaceholder}
          aria-label={t.searchAriaLabel}
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <select name="status" defaultValue={status} aria-label={t.statusFilterAriaLabel} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">{t.allStatuses}</option>
          {projectStatusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          {dictionaries[locale].common.filter}
        </button>
        {hasFilters && <a href="/admin/crm/projects" className="text-xs text-pm-gris underline">{t.reset}</a>}
      </form>

      {allProjects.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? t.emptyNoneTitle : t.emptyFilteredTitle}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {allProjects.map((project) => (
              <div key={project.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link href={`/admin/crm/clients/${project.clientId}`} className="font-medium text-pm-noir hover:underline">
                      {project.name}
                    </Link>
                    <p className="text-xs text-pm-gris">
                      {clientNameById.get(project.clientId) ?? t.noValue}
                      {project.dueDate ? ` · ${t.duePrefix} ${formatDate(project.dueDate, locale)}` : ""}
                    </p>
                  </div>
                  <InlineStatusSelect value={project.status} options={projectStatusOptions} action={updateProjectStatus.bind(null, project.id)} />
                </div>
                {project.description && <p className="mt-2 text-sm text-pm-gris">{project.description}</p>}
                <div className="mt-2 flex items-center gap-3">
                  <EditProjectForm project={project} locale={locale} />
                  <DeleteProjectButton id={project.id} locale={locale} />
                </div>
              </div>
            ))}
          </div>

          {totalPages > 1 && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <a
                href={buildHref(params, { page: page > 1 ? String(page - 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page <= 1 ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                {dictionaries[locale].common.previous}
              </a>
              <span className="text-pm-gris">{t.pageOf(page, totalPages)}</span>
              <a
                href={buildHref(params, { page: page < totalPages ? String(page + 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                {dictionaries[locale].common.next}
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}
