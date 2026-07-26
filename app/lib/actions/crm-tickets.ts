"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { logCrmAudit } from "@/lib/audit";
import { dispatchWebhookEvent } from "@/lib/webhooks";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { clientRequired: "Client requis.", subjectRequired: "Sujet requis.", invalidStatus: "Statut invalide.", invalidPriority: "Priorité invalide.", ticketNotFound: "Ticket introuvable." },
  en: { clientRequired: "Client required.", subjectRequired: "Subject required.", invalidStatus: "Invalid status.", invalidPriority: "Invalid priority.", ticketNotFound: "Ticket not found." },
} as const;

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;
const PRIORITIES = ["low", "medium", "high"] as const;

export async function createTicket(formData: FormData) {
  const locale = await getLocale();
  const clientId = formData.get("clientId");
  const subject = formData.get("subject");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error(MESSAGES[locale].clientRequired);
  }
  if (typeof subject !== "string" || !subject.trim()) {
    throw new Error(MESSAGES[locale].subjectRequired);
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
