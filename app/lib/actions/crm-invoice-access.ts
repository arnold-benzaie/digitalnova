"use server";

import { randomBytes } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { db } from "@/db";
import { crmInvoiceAccessLinks, crmInvoices } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { clientIpFromHeaders } from "@/lib/gbp-audit/client-ip";
import { checkRateLimit } from "@/lib/api-v1/rate-limit";

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

/** Staff-only — creates (or returns the existing, still-usable) token link
 * for an invoice. Called from deliverInvoiceEmail() right before sending,
 * never exposed as its own public entry point with a client-supplied id
 * beyond the invoiceId a staff session already has the right to act on
 * (requireStaffRole gates every caller of this module). */
export async function createOrGetInvoiceAccessLink(invoiceId: string) {
  await requireStaffRole();

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
