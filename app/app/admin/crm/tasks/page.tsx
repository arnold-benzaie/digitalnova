import { and, asc, desc, eq, ilike, inArray, isNotNull, isNull, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, staffMembers, tasks, users } from "@/db/schema";
import { Badge, TASK_STATUS_CLASS, TASK_STATUS_OPTIONS, getTaskStatusOptions } from "@/components/crm/badges";
import { CreateTaskForm } from "@/components/crm/create-task-form";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { DeleteTaskButton, EditTaskForm } from "@/components/crm/task-actions";
import { updateTaskStatus } from "@/lib/actions/crm-tasks";
import { requireStaffRole } from "@/lib/dev-role";
import { getInternalOrganizationId } from "@/lib/notifications";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";
import { AdminPageHero, panelClass } from "@/components/admin/page-hero";
import { isFollowUpTaskRow, sanitizeTaskTypeFilter } from "./task-row-type";

const STATUS_VALUES = TASK_STATUS_OPTIONS.map((o) => o.value);
const PAGE_SIZE = 20;

type Params = { q?: string; status?: string; type?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/crm/tasks?${qs}` : "/admin/crm/tasks";
}

export default async function CrmTasksPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const [params, locale] = await Promise.all([searchParams, getLocale()]);
  const t = dictionaries[locale].crm.tasks;
  const tFollowUp = t.followUp;
  const taskStatusOptions = getTaskStatusOptions(locale);
  const taskStatusLabel = Object.fromEntries(taskStatusOptions.map((o) => [o.value, o.label]));

  const q = params.q?.trim() ?? "";
  const status = params.status && STATUS_VALUES.includes(params.status) ? params.status : "";
  // RADAR-CORE-3D — closed-enum type filter. `followup` = client-linked AND
  // dated (STATUS-INDEPENDENT — includes done/cancelled); `task` = the
  // De Morgan complement (clientless OR undated → G1/G2/G3).
  const type = sanitizeTaskTypeFilter(params.type);
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) conditions.push(ilike(tasks.title, `%${q}%`));
  if (status) conditions.push(eq(tasks.status, status));
  if (type === "followup") conditions.push(and(isNotNull(tasks.clientId), isNotNull(tasks.dueDate)));
  else if (type === "task") conditions.push(or(isNull(tasks.clientId), isNull(tasks.dueDate)));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [allTasks, allClients, [{ count: totalCount }], [{ count: overallCount }]] = await Promise.all([
    db
      .select()
      .from(tasks)
      .where(whereClause)
      .orderBy(desc(tasks.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
    db.select({ count: sql<number>`count(*)::int` }).from(tasks).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(tasks),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || status || type !== "all");

  // RADAR-CORE-3D — structured follow-up owner identity, resolved in ONE
  // batched query for the FOLLOW-UP rows on this page only (client-linked +
  // dated). A generic G2 row (clientless + dated) is deliberately NOT
  // collected here — it keeps its legacy free-text `assignee` display.
  // Mirrors the reviewed RADAR-CORE-3C client-detail resolver: a stale /
  // removed / suspended assignee stays assigned but reads as inactive; an
  // unresolvable id renders a localized "Former user", never the raw id.
  const followUpAssigneeIds = [
    ...new Set(
      allTasks.filter(isFollowUpTaskRow).map((task) => task.assignedUserId).filter((v): v is string => Boolean(v)),
    ),
  ];
  const followUpAssigneeById = new Map<string, { name: string | null; active: boolean }>();
  if (followUpAssigneeIds.length > 0) {
    const internalOrgId = await getInternalOrganizationId();
    const rows = await db
      .select({ id: users.id, fullName: users.fullName, email: users.email, staffStatus: staffMembers.status })
      .from(users)
      .leftJoin(
        staffMembers,
        internalOrgId
          ? and(eq(staffMembers.userId, users.id), eq(staffMembers.workspaceOrgId, internalOrgId))
          : eq(staffMembers.userId, users.id),
      )
      .where(inArray(users.id, followUpAssigneeIds));
    for (const row of rows) {
      followUpAssigneeById.set(row.id, {
        name: row.fullName ?? row.email ?? null,
        active: Boolean(internalOrgId) && row.staffStatus === "ACTIVE",
      });
    }
  }

  function followUpOwnerLabel(assignedUserId: string | null): string {
    if (!assignedUserId) return tFollowUp.unassigned;
    const info = followUpAssigneeById.get(assignedUserId);
    if (!info || info.name === null) return tFollowUp.formerUser;
    return info.active ? info.name : `${info.name} ${tFollowUp.inactiveSuffix}`;
  }

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.resultsSummary(totalCount, overallCount, hasFilters)} />

      <div className={`mt-6 ${panelClass}`}>
        <CreateTaskForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} locale={locale} />
      </div>

      <form action="/admin/crm/tasks" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
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
          {taskStatusOptions.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select name="type" defaultValue={type === "all" ? "" : type} aria-label={tFollowUp.typeFilterLabel} className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">{tFollowUp.typeAll}</option>
          <option value="followup">{tFollowUp.typeFollowUps}</option>
          <option value="task">{tFollowUp.typeTasks}</option>
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          {dictionaries[locale].common.filter}
        </button>
        {hasFilters && <a href="/admin/crm/tasks" className="text-xs text-pm-gris underline">{t.reset}</a>}
      </form>

      {allTasks.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? t.emptyNoneTitle : t.emptyFilteredTitle}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {allTasks.map((task) => {
              const clientCell = task.clientId ? (
                <Link href={`/admin/crm/clients/${task.clientId}`} className="hover:underline">
                  {clientNameById.get(task.clientId) ?? t.noValue}
                </Link>
              ) : (
                t.internal
              );
              // Written once — applies to any row whose task.dueDate is
              // non-null, so a generic G2 (clientless + dated) row keeps
              // its due date exactly as before.
              const dueCell = task.dueDate ? ` · ${t.duePrefix} ${formatDate(task.dueDate, locale)}` : "";

              return isFollowUpTaskRow(task) ? (
                // FOLLOW-UP ROW — client-linked + dated. Structured owner +
                // read-only status Badge; lifecycle actions (claim / assign
                // / complete / cancel / reopen / reschedule) live on the
                // prospect-detail page, reachable via the client link.
                <div key={task.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-pm-noir">{task.title}</p>
                      <Badge label={tFollowUp.typeFollowUp} className="bg-pm-or/10 text-pm-or-2" />
                    </div>
                    <p className="text-xs text-pm-gris">
                      {clientCell}
                      {" · "}
                      {tFollowUp.owner}: {followUpOwnerLabel(task.assignedUserId)}
                      {dueCell}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <Badge label={taskStatusLabel[task.status] ?? task.status} className={TASK_STATUS_CLASS[task.status] ?? ""} />
                    <EditTaskForm task={task} locale={locale} />
                    <DeleteTaskButton id={task.id} locale={locale} />
                  </div>
                </div>
              ) : (
                // GENERIC TASK ROW — G1 / G2 / G3 (not client-linked+dated).
                // Legacy free-text `assignee` + InlineStatusSelect preserved
                // verbatim. A G2 row (clientless + dated) still shows its
                // formatted due date via the shared dueCell above.
                <div key={task.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4 shadow-[0_8px_22px_rgba(13,36,67,0.05)] transition-[box-shadow,border-color] duration-200 hover:border-[#d9e3ef] hover:shadow-[0_11px_26px_rgba(13,36,67,0.09)]">
                  <div>
                    <div className="flex flex-wrap items-center gap-2">
                      <p className="font-medium text-pm-noir">{task.title}</p>
                      <Badge label={tFollowUp.typeTask} className="bg-pm-gris-2/60 text-pm-gris" />
                    </div>
                    <p className="text-xs text-pm-gris">
                      {clientCell}
                      {task.assignee ? ` · ${task.assignee}` : ""}
                      {dueCell}
                    </p>
                  </div>
                  <div className="flex shrink-0 items-center gap-3">
                    <InlineStatusSelect value={task.status} options={taskStatusOptions} action={updateTaskStatus.bind(null, task.id)} />
                    <EditTaskForm task={task} locale={locale} />
                    <DeleteTaskButton id={task.id} locale={locale} />
                  </div>
                </div>
              );
            })}
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
