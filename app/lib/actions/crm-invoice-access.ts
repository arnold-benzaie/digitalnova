"use server";

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { crmInvoiceAccessLinks, crmInvoices } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { requireCrmClientAccess, resolveCrmEmployeeScope } from "@/lib/crm-client-access";
import { clientIpFromHeaders } from "@/lib/gbp-audit/client-ip";
import { checkRateLimit } from "@/lib/api-v1/rate-limit";
import { getLocale } from "@/lib/i18n/locale";

/**
 * Secure, unauthenticated access to a single invoice's PDF for its
 * (external) client — mirrors lib/actions/gbp-audit-report.ts's
 * createOrGetReportAccessLink()/lib/actions/gbp-audit-portal.ts's
 * resolveReportByToken() exactly: a random, unguessable token is the sole
 * credential, rate-limited and attempt-capped at resolution time. The
 * existing staff-facing PDF route (app/api/crm/invoices/[id]/pdf/route.ts,
 * session-gated, raw id) is untouched — this is a separate, additional,
 * public-but-token-gated path used only by the emailed link.
 */

const RATE_LIMIT_SCOPE = "crm_invoice_token";
const RATE_LIMIT_PER_WINDOW = 30;
const RATE_LIMIT_WINDOW_SECONDS = 300;

const MESSAGES = {
  fr: { invoiceNotFound: "Facture introuvable." },
  en: { invoiceNotFound: "Invoice not found." },
} as const;

/** Staff-only — creates (or returns the existing, still-usable) token link
 * for an invoice. Called from deliverInvoiceEmail() (lib/actions/crm-invoices.ts,
 * itself already scoped since R9-E) right before sending, and from the
 * staff-facing PDF route (app/api/crm/invoices/[id]/pdf/route.ts, not yet
 * scoped — tracked separately as R9-H). This function's own check below
 * is what actually stops an EMPLOYEE outside their scope from reading
 * back or minting a valid public credential via EITHER caller, since
 * neither caller's own protection (or lack of it) can be relied upon. */
export async function createOrGetInvoiceAccessLink(invoiceId: string) {
  await requireStaffRole();
  const locale = await getLocale();

  const [invoice] = await db
    .select({ id: crmInvoices.id, clientId: crmInvoices.clientId })
    .from(crmInvoices)
    .where(eq(crmInvoices.id, invoiceId))
    .limit(1);
  if (!invoice) throw new Error(MESSAGES[locale].invoiceNotFound);

  // R9-G — checked BEFORE any read of crmInvoiceAccessLinks (reusing an
  // existing token) or any write to it (minting a new one): both are the
  // exact side effect this must gate — a denied EMPLOYEE must never read
  // back NOR create a valid public credential for an invoice outside
  // their scope. A NULL clientId (the "Autre client…" unsaved-manual-entry
  // case) is refused directly, since requireCrmClientAccess() takes a
  // real client id — same product decision already applied in
  // createInvoice/updateInvoice/updateInvoiceStatus (R9-C/R9-D/R9-E).
  // Same anti-enumeration message as "invoice doesn't exist" — never
  // reveals that the invoice exists, that a link exists, its token, or
  // its revoked/expired state.
  const scope = await resolveCrmEmployeeScope();
  if (scope !== null) {
    if (invoice.clientId === null) throw new Error(MESSAGES[locale].invoiceNotFound);
    await requireCrmClientAccess(invoice.clientId, new Error(MESSAGES[locale].invoiceNotFound));
  }

  const [existing] = await db
    .select()
    .from(crmInvoiceAccessLinks)
    .where(eq(crmInvoiceAccessLinks.invoiceId, invoiceId))
    .limit(1);
  if (existing && !existing.revokedAt) return existing;

  const token = randomBytes(32).toString("base64url");
  const [link] = await db.insert(crmInvoiceAccessLinks).values({ invoiceId, token }).returning();
  return link;
}

/**
 * PUBLIC — no Clerk session, no staff role. This is the ONLY server-side
 * entry point the token-gated PDF route may call. Possession of a valid,
 * non-revoked, non-expired token (within the attempt budget) is the sole
 * credential, exactly like gbpReportAccessLinks — never the raw invoice id.
 */
export async function resolveInvoiceByToken(token: string) {
  const hdrs = await headers();
  const ip = clientIpFromHeaders(hdrs);

  const rate = await checkRateLimit(RATE_LIMIT_SCOPE, ip, RATE_LIMIT_PER_WINDOW, RATE_LIMIT_WINDOW_SECONDS);
  if (!rate.allowed) return { ok: false as const, reason: "rate_limited" as const };

  const [link] = await db.select().from(crmInvoiceAccessLinks).where(eq(crmInvoiceAccessLinks.token, token)).limit(1);
  if (!link) return { ok: false as const, reason: "not_found" as const };
  if (link.failedAttempts >= link.maxAttempts) return { ok: false as const, reason: "locked" as const };

  async function recordFailure(reason: "revoked" | "expired") {
    await db.update(crmInvoiceAccessLinks).set({ failedAttempts: sql`${crmInvoiceAccessLinks.failedAttempts} + 1` }).where(eq(crmInvoiceAccessLinks.id, link.id));
    return { ok: false as const, reason };
  }
  if (link.revokedAt) return recordFailure("revoked");
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return recordFailure("expired");

  const [invoice] = await db.select().from(crmInvoices).where(eq(crmInvoices.id, link.invoiceId)).limit(1);
  if (!invoice) return { ok: false as const, reason: "not_found" as const };

  return { ok: true as const, invoice };
}
