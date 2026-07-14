"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { db } from "@/db";
import { tickets } from "@/db/schema";
import { logAudit } from "@/lib/audit";
import { dispatchWebhookEvent } from "@/lib/webhooks";

const STATUSES = ["open", "in_progress", "resolved", "closed"] as const;

export async function createTicket(formData: FormData) {
  const clientId = formData.get("clientId");
  const subject = formData.get("subject");
  if (typeof clientId !== "string" || !clientId) {
    throw new Error("Client requis.");
  }
  if (typeof subject !== "string" || !subject.trim()) {
    throw new Error("Sujet requis.");
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

  await logAudit({
    action: "crm.ticket_created",
    targetType: "ticket",
    targetId: ticket.id,
    metadata: { subject: ticket.subject, priority: ticket.priority },
  });

  await dispatchWebhookEvent("ticket.created", { ticketId: ticket.id, clientId, priority: ticket.priority });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tickets");
  revalidatePath(`/admin/crm/clients/${clientId}`);
}

export async function updateTicketStatus(id: string, status: string) {
  if (!STATUSES.includes(status as (typeof STATUSES)[number])) {
    throw new Error("Statut invalide.");
  }

  const [ticket] = await db
    .update(tickets)
    .set({ status, resolvedAt: status === "resolved" || status === "closed" ? new Date() : null })
    .where(eq(tickets.id, id))
    .returning();

  await logAudit({
    action: "crm.ticket_status_changed",
    targetType: "ticket",
    targetId: id,
    metadata: { status },
  });

  revalidatePath("/admin/crm");
  revalidatePath("/admin/crm/tickets");
  if (ticket) revalidatePath(`/admin/crm/clients/${ticket.clientId}`);
}
