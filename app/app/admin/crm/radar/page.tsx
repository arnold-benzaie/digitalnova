import Link from "next/link";
import { getRadarQueue, type RadarAssigneeFilter } from "@/lib/actions/radar-queue";
import { listAssignableRadarMembers } from "@/lib/actions/radar-assignment";
import type { Confidence, Priority } from "@/lib/radar/score";
import { Badge, CLIENT_STAGE_CLASS, getClientStageOptions } from "@/components/crm/badges";
import { RadarAssignmentControls } from "@/components/crm/radar-assignment-controls";
import { AdminPageHero, panelClass, tableWrapperClass } from "@/components/admin/page-hero";
import { requireStaffRole } from "@/lib/dev-role";
import { requireSession } from "@/lib/session";
import { getRadarCapabilities } from "@/lib/rbac/require-staff-member";
import { getLocale } from "@/lib/i18n/locale";
import { dictionaries } from "@/lib/i18n/dictionaries";
import { formatDate } from "@/lib/i18n/format";

// Same color tokens already used by CLIENT_STAGE_CLASS/TICKET_PRIORITY_CLASS
// in components/crm/badges.tsx (NEUTRAL/WARM/BAD) — copied here rather than
// imported because those tokens are module-private there, and Badge itself
// must not be modified merely for Radar. HIGH -> BAD, MEDIUM -> WARM,
// LOW -> NEUTRAL, matching the existing ticket-priority precedent exactly.
const PRIORITY_CLASS: Record<Priority, string> = {
  HIGH: "bg-pm-rouge/10 text-pm-rouge-2",
  MEDIUM: "bg-pm-or/10 text-pm-or-2",
  LOW: "bg-pm-gris-2/60 text-pm-gris",
};

const VALID_PRIORITIES: readonly Priority[] = ["HIGH", "MEDIUM", "LOW"];

function sanitizePriorityParam(value: string | undefined): Priority | undefined {
  return value && (VALID_PRIORITIES as readonly string[]).includes(value) ? (value as Priority) : undefined;
}

// RADAR-CORE-1B — only three URL tokens are accepted; anything else is
// "all". "me" is the ONLY dynamic one and it resolves to the server
// session id here, never a caller-supplied user id.
type AssigneeParam = "all" | "me" | "unassigned";
const VALID_ASSIGNEE_PARAMS: readonly AssigneeParam[] = ["all", "me", "unassigned"];

function sanitizeAssigneeParam(value: string | undefined): AssigneeParam {
  return value && (VALID_ASSIGNEE_PARAMS as readonly string[]).includes(value) ? (value as AssigneeParam) : "all";
}

// Canonical positive integer only — no leading zero, no sign, no decimal,
// no exponent, no surrounding whitespace — then range-checked against
// Number.isSafeInteger so a syntactically valid but too-large string (e.g.
// beyond Number.MAX_SAFE_INTEGER) can't produce an unsafe numeric value.
// Deliberately local/minimal: this validates a raw URL string, a different
// problem from Phase 1D's sanitizePage() (which validates an already-typed
// number), so it isn't a duplicate of that logic.
const CANONICAL_POSITIVE_INTEGER = /^[1-9]\d*$/;

function sanitizePageParam(value: string | undefined): number {
  if (!value || !CANONICAL_POSITIVE_INTEGER.test(value)) return 1;
  const parsed = Number(value);
  return Number.isSafeInteger(parsed) ? parsed : 1;
}

function buildHref(priority: Priority | undefined, assignee: AssigneeParam, page: number | undefined) {
  const qs = new URLSearchParams();
  if (priority) qs.set("priority", priority);
  if (assignee !== "all") qs.set("assignee", assignee);
  if (page && page > 1) qs.set("page", String(page));
  const s = qs.toString();
  return s ? `/admin/crm/radar?${s}` : "/admin/crm/radar";
}

type Params = { priority?: string; assignee?: string; page?: string };

export default async function CrmRadarPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const [params, locale, { userId: currentUserId }, caps] = await Promise.all([
    searchParams,
    getLocale(),
    requireSession(),
    getRadarCapabilities(),
  ]);
  const t = dictionaries[locale].crm.radar;
  const stageLabel = Object.fromEntries(getClientStageOptions(locale).map((o) => [o.value, o.label]));

  const priority = sanitizePriorityParam(params.priority);
  const assignee = sanitizeAssigneeParam(params.assignee);
  const page = sanitizePageParam(params.page);

  // "me" is resolved to the server session id here — getRadarQueue never
  // sees the raw token, and there is no arbitrary assignee-user URL filter.
  const assigneeFilter: RadarAssigneeFilter =
    assignee === "me"
      ? { mode: "user", userId: currentUserId }
      : assignee === "unassigned"
        ? { mode: "unassigned" }
        : { mode: "all" };

  const [result, assignables] = await Promise.all([
    getRadarQueue({ page, priority: priority ? [priority] : undefined, assignee: assigneeFilter }),
    caps.canAssignOthers ? listAssignableRadarMembers() : Promise.resolve([]),
  ]);

  const priorityLabel: Record<Priority, string> = { HIGH: t.priorityHigh, MEDIUM: t.priorityMedium, LOW: t.priorityLow };
  const confidenceLabel: Record<Confidence, string> = { HIGH: t.confidenceHigh, MEDIUM: t.confidenceMedium, LOW: t.confidenceLow };

  // The Owner/Responsable column is part of the queue READ model: it is
  // shown to every viewer the page's requireStaffRole() gate admits.
  // Axis-C `caps` govern only the interactive affordances INSIDE
  // RadarAssignmentControls (Claim / assignee select / Release) — never
  // whether the assignment data is visible.

  // totalQualified is computed BEFORE any filter (see
  // lib/actions/radar-queue.ts) — safe to use for "Page X of Y" only when
  // NO filter (priority OR assignee) narrows the displayed population. With
  // a filter active, the API cannot truthfully report a filtered total page
  // count, so pagination falls back to a Previous/Next-only heuristic (Next
  // enabled only when a full page came back) rather than guessing.
  const anyFilter = Boolean(priority) || assignee !== "all";
  const totalPages = Math.max(1, Math.ceil(result.totalQualified / result.pageSize));
  const showPageCount = !anyFilter;
  const hasPrevious = page > 1;
  const hasNext = anyFilter ? result.items.length === result.pageSize : page < totalPages;

  return (
    <>
      <AdminPageHero title={t.title} subtitle={t.subtitle} />

      <form action="/admin/crm/radar" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <label htmlFor="priority" className="sr-only">
          {t.priorityFilterLabel}
        </label>
        <select
          id="priority"
          name="priority"
          defaultValue={priority ?? ""}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          <option value="">{t.allPriorities}</option>
          <option value="HIGH">{t.priorityHigh}</option>
          <option value="MEDIUM">{t.priorityMedium}</option>
          <option value="LOW">{t.priorityLow}</option>
        </select>
        <label htmlFor="assignee" className="sr-only">
          {t.assigneeFilterLabel}
        </label>
        <select
          id="assignee"
          name="assignee"
          defaultValue={assignee === "all" ? "" : assignee}
          className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir"
        >
          <option value="">{t.assigneeAll}</option>
          <option value="me">{t.assigneeMine}</option>
          <option value="unassigned">{t.assigneeUnassigned}</option>
        </select>
        <button
          type="submit"
          className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2"
        >
          {dictionaries[locale].common.filter}
        </button>
        {(priority || assignee !== "all") && (
          <Link href="/admin/crm/radar" className="text-xs text-pm-gris underline">
            {t.reset}
          </Link>
        )}
      </form>

      <p className="mt-3 text-xs text-pm-gris">
        {t.confidencePrefix} — {t.confidenceCaption}
      </p>

      {(result.insufficientDataCount > 0 || result.notEligibleCount > 0) && (
        <div className={`mt-4 flex flex-wrap gap-x-6 gap-y-1 ${panelClass} px-5 py-3 text-xs text-pm-gris`}>
          {result.insufficientDataCount > 0 && <span>{t.insufficientDataSummary(result.insufficientDataCount)}</span>}
          {result.notEligibleCount > 0 && <span>{t.notEligibleSummary(result.notEligibleCount)}</span>}
        </div>
      )}

      {result.totalQualified === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.emptyNoneTitle}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyNoneDescription}</p>
        </div>
      ) : result.items.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">{t.emptyFilteredTitle}</p>
          <p className="mt-1 text-sm text-pm-gris">{t.emptyFilteredDescription}</p>
        </div>
      ) : (
        <>
          <div className={`mt-6 overflow-x-auto ${tableWrapperClass}`}>
            <table className="w-full text-left text-sm">
              <thead className="bg-pm-gris-2/30 text-xs uppercase tracking-wide text-pm-gris">
                <tr>
                  <th className="px-5 py-3">{t.columns.prospect}</th>
                  <th className="px-5 py-3">{t.columns.priority}</th>
                  <th className="px-5 py-3">{t.columns.why}</th>
                  <th className="px-5 py-3">{t.columns.nextAction}</th>
                  <th className="px-5 py-3">{t.columns.stage}</th>
                  <th className="px-5 py-3">{t.columns.lastInteraction}</th>
                  <th className="px-5 py-3 text-right">{t.columns.owner}</th>
                </tr>
              </thead>
              <tbody>
                {result.items.map((item) => {
                  const location = [item.city, item.region, item.country].filter(Boolean).join(", ");
                  return (
                    <tr key={item.clientId} className="border-t border-pm-gris-2">
                      <td className="px-5 py-3 font-medium text-pm-noir">
                        <Link href={`/admin/crm/clients/${item.clientId}`} className="hover:underline">
                          {item.name}
                        </Link>
                        <div className="mt-0.5 text-xs font-normal text-pm-gris">
                          {[item.industry, location].filter(Boolean).join(" — ") || t.noValue}
                        </div>
                      </td>
                      <td className="px-5 py-3">
                        <Badge label={priorityLabel[item.priority]} className={PRIORITY_CLASS[item.priority]} />
                        <div className="mt-1 text-xs text-pm-gris">
                          {t.confidencePrefix}: {confidenceLabel[item.confidence]}
                        </div>
                      </td>
                      <td className="px-5 py-3 text-pm-gris">
                        {item.reasons.slice(0, 2).map((reason, i) => (
                          <div key={i}>{reason}</div>
                        ))}
                      </td>
                      <td className="px-5 py-3">
                        <div className="font-medium text-pm-noir">{item.recommendedNextAction}</div>
                        <Link href={`/admin/crm/clients/${item.clientId}`} className="text-xs text-pm-gris underline hover:text-pm-noir">
                          {t.viewClient}
                        </Link>
                      </td>
                      <td className="px-5 py-3">
                        <Badge label={stageLabel[item.stage] ?? item.stage} className={CLIENT_STAGE_CLASS[item.stage] ?? ""} />
                      </td>
                      <td className="px-5 py-3 text-pm-gris">
                        {item.lastInteractionAt ? formatDate(item.lastInteractionAt, locale) : t.noInteraction}
                      </td>
                      <td className="px-5 py-3 align-top">
                        <RadarAssignmentControls
                          clientId={item.clientId}
                          assignedUserId={item.assignedUserId}
                          assignedUserName={item.assignedUserName}
                          assignedUserActive={item.assignedUserActive}
                          currentUserId={currentUserId}
                          caps={caps}
                          assignables={assignables}
                          locale={locale}
                          t={t.assignment}
                        />
                      </td>
                    </tr>
                  );
                })}
              </tbody>
            </table>
          </div>

          {(hasPrevious || hasNext) && (
            <div className="mt-4 flex items-center justify-between text-sm">
              <Link
                href={buildHref(priority, assignee, page > 1 ? page - 1 : undefined)}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${hasPrevious ? "hover:bg-pm-gris-2/30" : "pointer-events-none opacity-40"}`}
              >
                {dictionaries[locale].common.previous}
              </Link>
              {showPageCount && <span className="text-pm-gris">{t.pageOf(page, totalPages)}</span>}
              <Link
                href={buildHref(priority, assignee, hasNext ? page + 1 : undefined)}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${hasNext ? "hover:bg-pm-gris-2/30" : "pointer-events-none opacity-40"}`}
              >
                {dictionaries[locale].common.next}
              </Link>
            </div>
          )}
        </>
      )}
    </>
  );
}
