import { and, asc, desc, eq, ilike, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { calendarEvents, crmClients } from "@/db/schema";
import { CreateEventForm } from "@/components/crm/create-event-form";
import { DeleteEventButton, EditEventForm } from "@/components/crm/event-actions";
import { requireStaffRole } from "@/lib/dev-role";

const TYPE_OPTIONS = [
  { value: "meeting", label: "Rendez-vous" },
  { value: "call", label: "Appel" },
  { value: "deadline", label: "Échéance" },
  { value: "other", label: "Autre" },
];
const TYPE_LABEL: Record<string, string> = Object.fromEntries(TYPE_OPTIONS.map((o) => [o.value, o.label]));
const TYPE_VALUES = TYPE_OPTIONS.map((o) => o.value);
const PAGE_SIZE = 20;

type Params = { q?: string; type?: string; when?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/crm/calendar?${qs}` : "/admin/crm/calendar";
}

export default async function CrmCalendarPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const params = await searchParams;

  const q = params.q?.trim() ?? "";
  const type = params.type && TYPE_VALUES.includes(params.type) ? params.type : "";
  const when = params.when === "past" ? "past" : "upcoming";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const now = new Date();
  const conditions = [];
  if (q) conditions.push(ilike(calendarEvents.title, `%${q}%`));
  if (type) conditions.push(eq(calendarEvents.type, type));
  const whenCondition = when === "past" ? sql`${calendarEvents.startAt} < ${now}` : sql`${calendarEvents.startAt} >= ${now}`;
  const whereClause = and(whenCondition, ...conditions);

  const [allEvents, allClients, [{ count: totalCount }], [{ count: overallCount }]] = await Promise.all([
    db
      .select()
      .from(calendarEvents)
      .where(whereClause)
      .orderBy(when === "past" ? desc(calendarEvents.startAt) : asc(calendarEvents.startAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
    db.select({ count: sql<number>`count(*)::int` }).from(calendarEvents).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(calendarEvents),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || type || when === "past");

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Calendrier</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {totalCount} résultat(s){hasFilters ? ` sur ${overallCount} au total` : ""}
      </p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <CreateEventForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      <form action="/admin/crm/calendar" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rechercher par titre…"
          aria-label="Rechercher un événement"
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <select name="type" defaultValue={type} aria-label="Filtrer par type" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">Tous les types</option>
          {TYPE_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select name="when" defaultValue={when} aria-label="À venir ou passés" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="upcoming">À venir</option>
          <option value="past">Passés</option>
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          Filtrer
        </button>
        {hasFilters && <a href="/admin/crm/calendar" className="text-xs text-pm-gris underline">Réinitialiser</a>}
      </form>

      {allEvents.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? "Aucun événement" : "Aucun résultat"}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {allEvents.map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4">
                <div>
                  <p className="font-medium text-pm-noir">{event.title}</p>
                  <p className="text-xs text-pm-gris">
                    {TYPE_LABEL[event.type] ?? event.type}
                    {event.clientId && (
                      <>
                        {" · "}
                        <Link href={`/admin/crm/clients/${event.clientId}`} className="hover:underline">
                          {clientNameById.get(event.clientId) ?? "—"}
                        </Link>
                      </>
                    )}
                  </p>
                </div>
                <div className="flex shrink-0 items-center gap-3">
                  <span className="text-sm text-pm-noir">
                    {new Date(event.startAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
                  </span>
                  <EditEventForm event={event} />
                  <DeleteEventButton id={event.id} />
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
                Précédent
              </a>
              <span className="text-pm-gris">Page {page} / {totalPages}</span>
              <a
                href={buildHref(params, { page: page < totalPages ? String(page + 1) : undefined })}
                className={`rounded-lg border border-pm-gris-2 px-3 py-1.5 ${page >= totalPages ? "pointer-events-none opacity-40" : "hover:bg-pm-gris-2/30"}`}
              >
                Suivant
              </a>
            </div>
          )}
        </>
      )}
    </>
  );
}
