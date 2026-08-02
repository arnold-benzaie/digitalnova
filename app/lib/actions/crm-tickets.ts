"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { crmClients, tickets } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { getInternalOrganizationId, notify } from "@/lib/notifications";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: {
    clientRequired: "Client requis.",
    newClientNameRequired: "Nom du nouveau client requis.",
    subjectRequired: "Sujet requis.",
    invalidStatus: "Statut invalide.",
    invalidPriority: "Priorité invalide.",
    ticketNotFound: "Ticket introuvable.",
  },
  en: {
    clientRequired: "Client required.",
    newClientNameRequired: "New client name required.",
    subjectRequired: "Subject required.",
    invalidStatus: "Invalid status.",
    invalidPriority: "Invalid priority.",
    ticketNotFound: "Ticket not found.",
  },
} as const;

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const PRIORITIES = ["low", "medium", "high"] as const;

// Sentinel for "Autre (nouveau client)" in the client <select> — matched
// against components/crm/create-ticket-form.tsx's own literal value.
const NEW_CLIENT_SENTINEL = "__new__";

/**
 * clientId is either an existing crm_clients.id, or the NEW_CLIENT_SENTINEL
 * paired with a newClientName — tickets.clientId is a required FK (see
 * db/schema.ts), so "Autre" can't just pass a free-text name through:
 * a real crm_clients row (stage "lead", same default as every other
 * client creation path) is created first, and the ticket links to that.
 * Returns { error } for expected validation outcomes instead of throwing
 * — same reasoning as lib/actions/users.ts's inviteUser() and
 * lib/actions/gbp-audit-staff.ts's inviteAuditStaff(): Next.js redacts
 * thrown Server Action error messages in production builds.
 */
export async function createTicket(formData: FormData): Promise<{ error: string } | undefined> {
  const locale = await getLocale();
  const clientIdRaw = formData.get("clientId");
  const subject = formData.get("subject");
  if (typeof clientIdRaw !== "string" || !clientIdRaw) {
    return { error: MESSAGES[locale].clientRequired };
  }
  if (typeof subject !== "string" || !subject.trim()) {
    return { error: MESSAGES[locale].subjectRequired };
  }

  let clientId = clientIdRaw;
  if (clientIdRaw === NEW_CLIENT_SENTINEL) {
    const newClientName = formData.get("newClientName");
    if (typeof newClientName !== "string" || !newClientName.trim()) {
      return { error: MESSAGES[locale].newClientNameRequired };
    }
    const [newClient] = await db.insert(crmClients).values({ name: newClientName.trim(), stage: "lead" }).returning();
    clientId = newClient.id;
  }

  const priority = formData.get("priority");

  const [ticket] = await db
    .insert(tickets)
    .values({
      clientId,
      subject: subject.trim(),
      description: (formData.get("description") as string) || null,
      priority: typeof priority === "string" && priority ? priority : "medium",
    })
    .returning();

  await logCrmAudit({
    action: "crm.ticket_created",
    targetType: "ticket",
    targetId: ticket.id,
    clientId,
    metadata: { subject: ticket.subject, priority: ticket.priority },
  });

  await dispatchWebhookEvent("ticket.created", { ticketId: ticket.id, clientId, priority: ticket.priority });

  // Tickets are crm_clients-scoped, not organizationId-scoped, and this is
  // a staff-facing event (a new client request to triage) — same internal-
  // organization broadcast target refuseUser() already uses for its own
  // admin-facing notification.
  const internalOrgId = await getInternalOrganizationId();
  if (internalOrgId) {
    await notify({
      organizationId: internalOrgId,
      type: "ticket.created",
      metadata: { subject: ticket.subject },
    });
  }

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tickets");
  revalidatePath(`/admin/crm/clients/${clientId}`);
}

export async function updateTicketStatus(id: string, status: string) {
  const locale = await getLocale();
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error(MESSAGES[locale].invalidStatus);
  }

  const [ticket] = await db
    .update(tickets)
    .set({ status, resolvedAt: status === "resolved" || status === "closed" ? new Date() : null })
    .where(eq(tickets.id, id))
    .returning();

  await logCrmAudit({
    action: "crm.ticket_status_changed",
    targetType: "ticket",
    targetId: id,
    clientId: ticket?.clientId,
    metadata: { status },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tickets");
  if (ticket) revalidatePath(`/admin/crm/clients/${ticket.clientId}`);
}

/** Full edit — subject/description/priority; use updateTicketStatus for status. */
export async function updateTicket(id: string, formData: FormData) {
  const locale = await getLocale();
  const subject = formData.get("subject");
  if (typeof subject !== "string" || !subject.trim()) {
    throw new Error(MESSAGES[locale].subjectRequired);
  }

  const priority = formData.get("priority");
  if (typeof priority !== "string" || !PRIORITIES.includes(priority as (typeof PRIORITIES)[number])) {
    throw new Error(MESSAGES[locale].invalidPriority);
  }

  const [ticket] = await db
    .update(tickets)
    .set({
      subject: subject.trim(),
      description: (formData.get("description") as string) || null,
      priority,
    })
    .where(eq(tickets.id, id))
    .returning();
  if (!ticket) throw new Error(MESSAGES[locale].ticketNotFound);

  await logCrmAudit({
    action: "crm.ticket_updated",
    targetType: "ticket",
    targetId: id,
    clientId: ticket.clientId,
    metadata: { subject: ticket.subject, priority: ticket.priority },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tickets");
  revalidatePath(`/admin/crm/clients/${ticket.clientId}`);
  return ticket;
}

export async function deleteTicket(id: string) {
  const locale = await getLocale();
  const [ticket] = await db.delete(tickets).where(eq(tickets.id, id)).returning();
  if (!ticket) throw new Error(MESSAGES[locale].ticketNotFound);

  await logCrmAudit({
    action: "crm.ticket_deleted",
    targetType: "ticket",
    targetId: id,
    clientId: ticket.clientId,
    metadata: { subject: ticket.subject },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tickets");
  revalidatePath(`/admin/crm/clients/${ticket.clientId}`);
}
