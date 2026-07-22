import { and, asc, desc, eq, ilike, or, sql } from "drizzle-orm";
import Link from "next/link";
import { db } from "@/db";
import { crmClients, tickets } from "@/db/schema";
import {
  Badge,
  TICKET_PRIORITY_CLASS,
  TICKET_PRIORITY_LABEL,
  TICKET_STATUS_OPTIONS,
} from "@/components/crm/badges";
import { CreateTicketForm } from "@/components/crm/create-ticket-form";
import { InlineStatusSelect } from "@/components/crm/inline-status-select";
import { DeleteTicketButton, EditTicketForm } from "@/components/crm/ticket-actions";
import { updateTicketStatus } from "@/lib/actions/crm-tickets";
import { requireStaffRole } from "@/lib/dev-role";

const STATUS_VALUES = TICKET_STATUS_OPTIONS.map((o) => o.value);
const PRIORITY_OPTIONS = [
  { value: "low", label: "Basse" },
  { value: "medium", label: "Moyenne" },
  { value: "high", label: "Haute" },
];
const PRIORITY_VALUES = PRIORITY_OPTIONS.map((o) => o.value);
const PAGE_SIZE = 20;

type Params = { q?: string; status?: string; priority?: string; page?: string };

function buildHref(params: Params, overrides: Partial<Record<keyof Params, string | undefined>>) {
  const merged: Record<string, string> = {};
  for (const [key, value] of Object.entries({ ...params, ...overrides })) {
    if (value) merged[key] = value;
  }
  const qs = new URLSearchParams(merged).toString();
  return qs ? `/admin/crm/tickets?${qs}` : "/admin/crm/tickets";
}

export default async function CrmTicketsPage({ searchParams }: { searchParams: Promise<Params> }) {
  await requireStaffRole();
  const params = await searchParams;

  const q = params.q?.trim() ?? "";
  const status = params.status && STATUS_VALUES.includes(params.status) ? params.status : "";
  const priority = params.priority && PRIORITY_VALUES.includes(params.priority) ? params.priority : "";
  const page = Math.max(1, parseInt(params.page ?? "1", 10) || 1);

  const conditions = [];
  if (q) conditions.push(or(ilike(tickets.subject, `%${q}%`), ilike(tickets.description, `%${q}%`)));
  if (status) conditions.push(eq(tickets.status, status));
  if (priority) conditions.push(eq(tickets.priority, priority));
  const whereClause = conditions.length ? and(...conditions) : undefined;

  const [allTickets, allClients, [{ count: totalCount }], [{ count: overallCount }]] = await Promise.all([
    db
      .select()
      .from(tickets)
      .where(whereClause)
      .orderBy(desc(tickets.createdAt))
      .limit(PAGE_SIZE)
      .offset((page - 1) * PAGE_SIZE),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
    db.select({ count: sql<number>`count(*)::int` }).from(tickets).where(whereClause),
    db.select({ count: sql<number>`count(*)::int` }).from(tickets),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));
  const totalPages = Math.max(1, Math.ceil(totalCount / PAGE_SIZE));
  const hasFilters = Boolean(q || status || priority);

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Tickets support</h1>
      <p className="mt-2 text-sm text-pm-gris">
        {totalCount} résultat(s){hasFilters ? ` sur ${overallCount} au total` : ""}
      </p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <CreateTicketForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      <form action="/admin/crm/tickets" className="mt-6 flex flex-col gap-3 sm:flex-row sm:items-center">
        <input
          type="search"
          name="q"
          defaultValue={q}
          placeholder="Rechercher par sujet ou description…"
          aria-label="Rechercher un ticket"
          className="w-full rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir focus:outline-none focus:ring-2 focus:ring-pm-noir/20 sm:max-w-xs"
        />
        <select name="status" defaultValue={status} aria-label="Filtrer par statut" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">Tous les statuts</option>
          {TICKET_STATUS_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <select name="priority" defaultValue={priority} aria-label="Filtrer par priorité" className="rounded-lg border border-pm-gris-2 bg-white px-3 py-2 text-sm text-pm-noir">
          <option value="">Toutes les priorités</option>
          {PRIORITY_OPTIONS.map((o) => (
            <option key={o.value} value={o.value}>{o.label}</option>
          ))}
        </select>
        <button type="submit" className="rounded-lg bg-pm-noir px-4 py-2 text-sm font-medium text-white transition hover:bg-pm-noir-2">
          Filtrer
        </button>
        {hasFilters && (
          <a href="/admin/crm/tickets" className="text-xs text-pm-gris underline">Réinitialiser</a>
        )}
      </form>

      {allTickets.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">
            {overallCount === 0 ? "Aucun ticket" : "Aucun résultat"}
          </p>
        </div>
      ) : (
        <>
          <div className="mt-6 flex flex-col gap-3">
            {allTickets.map((ticket) => (
              <div key={ticket.id} className="rounded-2xl border border-pm-gris-2 bg-white p-4">
                <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between">
                  <div>
                    <Link href={`/admin/crm/clients/${ticket.clientId}`} className="font-medium text-pm-noir hover:underline">
                      {ticket.subject}
                    </Link>
                    <p className="text-xs text-pm-gris">{clientNameById.get(ticket.clientId) ?? "—"}</p>
                  </div>
                  <div className="flex shrink-0 items-center gap-2">
                    <Badge label={TICKET_PRIORITY_LABEL[ticket.priority] ?? ticket.priority} className={TICKET_PRIORITY_CLASS[ticket.priority] ?? ""} />
                    <InlineStatusSelect value={ticket.status} options={TICKET_STATUS_OPTIONS} action={updateTicketStatus.bind(null, ticket.id)} />
                  </div>
                </div>
                {ticket.description && <p className="mt-2 text-sm text-pm-gris">{ticket.description}</p>}
                <div className="mt-2 flex items-center gap-3">
                  <EditTicketForm ticket={ticket} />
                  <DeleteTicketButton id={ticket.id} />
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
