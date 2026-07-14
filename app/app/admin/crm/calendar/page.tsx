import { asc } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { calendarEvents, crmClients } from "@/db/schema";
import { CreateEventForm } from "@/components/crm/create-event-form";
import { requireStaffRole } from "@/lib/dev-role";

const TYPE_LABEL: Record<string, string> = {
  meeting: "Rendez-vous",
  call: "Appel",
  deadline: "Échéance",
  other: "Autre",
};

export default async function CrmCalendarPage() {
  await requireStaffRole();

  const [allEvents, allClients] = await Promise.all([
    db.select().from(calendarEvents).orderBy(asc(calendarEvents.startAt)),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
  const now = new Date();
  const upcoming = allEvents.filter((e) => new Date(e.startAt) >= now);
  const past = allEvents.filter((e) => new Date(e.startAt) < now);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Calendrier</h1>
      <p className="mt-2 text-sm text-pm-gris">Rendez-vous, appels et échéances de l&apos;agence.</p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <CreateEventForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">À venir</h2>
      {upcoming.length === 0 ? (
        <p className="mt-3 text-sm text-pm-gris">Aucun événement à venir.</p>
      ) : (
        <div className="mt-3 flex flex-col gap-3">
          {upcoming.map((event) => (
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
              <span className="shrink-0 text-sm text-pm-noir">
                {new Date(event.startAt).toLocaleString("fr-FR", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" })}
              </span>
            </div>
          ))}
        </div>
      )}

      {past.length > 0 && (
        <>
          <h2 className="mt-8 text-xs font-semibold uppercase tracking-wider text-pm-gris">Passés</h2>
          <div className="mt-3 flex flex-col gap-3">
            {past.slice(-10).reverse().map((event) => (
              <div key={event.id} className="flex items-center justify-between gap-4 rounded-2xl border border-pm-gris-2 bg-white p-4 opacity-70">
                <p className="text-sm text-pm-noir">{event.title}</p>
                <span className="shrink-0 text-xs text-pm-gris">
                  {new Date(event.startAt).toLocaleDateString("fr-FR")}
                </span>
              </div>
            ))}
          </div>
        </>
      )}
    </>
  );
}
