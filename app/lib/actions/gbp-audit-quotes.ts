"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpQuoteRequests } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { logAuditActivity } from "@/lib/gbp-audit/activity";

const QUOTE_STATUSES = ["new", "contacted", "won", "lost"] as const;

export async function updateQuoteRequestStatus(id: string, status: string) {
  await requireAuditStaffRole();
  if (!(QUOTE_STATUSES as readonly string[]).includes(status)) throw new Error("Statut invalide.");

  const { rowCount } = await auditDb.update(gbpQuoteRequests).set({ status }).where(eq(gbpQuoteRequests.id, id));
  if (rowCount === 0) throw new Error("Cette demande de devis est introuvable.");
  await logAuditActivity({ action: "quote_request_status_changed", targetType: "gbp_quote_requests", targetId: id, metadata: { status } });
  revalidatePath("/admin/audit/devis");
}
