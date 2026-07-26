"use server";

import { eq } from "drizzle-orm";
import { revalidatePath } from "next/cache";
import { auditDb } from "@/db/audit-index";
import { gbpQuoteRequests } from "@/db/audit-schema";
import { requireAuditStaffRole } from "@/lib/gbp-audit/session";
import { logAuditActivity } from "@/lib/gbp-audit/activity";
import { getLocale } from "@/lib/i18n/locale";

const MESSAGES = {
  fr: { invalidStatus: "Statut invalide.", requestNotFound: "Cette demande de devis est introuvable." },
  en: { invalidStatus: "Invalid status.", requestNotFound: "This quote request could not be found." },
} as const;

const QUOTE_STATUSES = ["new", "contacted", "won", "lost"] as const;

export async function updateQuoteRequestStatus(id: string, status: string) {
  const [, locale] = await Promise.all([requireAuditStaffRole(), getLocale()]);
  if (!(QUOTE_STATUSES as readonly string[]).includes(status)) throw new Error(MESSAGES[locale].invalidStatus);

  const { rowCount } = await auditDb.update(gbpQuoteRequests).set({ status }).where(eq(gbpQuoteRequests.id, id));
  if (rowCount === 0) throw new Error(MESSAGES[locale].requestNotFound);
  await logAuditActivity({ action: "quote_request_status_changed", targetType: "gbp_quote_requests", targetId: id, metadata: { status } });
  revalidatePath("/admin/audit/devis");
}
