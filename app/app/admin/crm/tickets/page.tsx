import { asc, desc } from "drizzle-orm";
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
import { updateTicketStatus } from "@/lib/actions/crm-tickets";
import { requireStaffRole } from "@/lib/dev-role";

export default async function CrmTicketsPage() {
  await requireStaffRole();

  const [allTickets, allClients] = await Promise.all([
    db.select().from(tickets).orderBy(desc(tickets.createdAt)),
    db.select().from(crmClients).orderBy(asc(crmClients.name)),
  ]);

  const clientNameById = new Map(allClients.map((c) => [c.id, c.name]));

  return (
    <>
      <h1 className="font-serif text-3xl font-semibold text-pm-noir">Tickets support</h1>
      <p className="mt-2 text-sm text-pm-gris">{allTickets.length} ticket(s).</p>

      <div className="mt-6 rounded-2xl border border-pm-gris-2 bg-white p-5">
        <CreateTicketForm clientOptions={allClients.map((c) => ({ id: c.id, name: c.name }))} />
      </div>

      {allTickets.length === 0 ? (
        <div className="mt-6 rounded-2xl border border-dashed border-pm-gris-2 bg-white p-8 text-center">
          <p className="font-serif text-lg font-semibold text-pm-noir">Aucun ticket</p>
        </div>
      ) : (
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
            </div>
          ))}
        </div>
      )}
    </>
  );
}
