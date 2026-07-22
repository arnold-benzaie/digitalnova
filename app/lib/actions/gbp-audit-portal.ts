"use server";

import { createHash } from "node:crypto";
import { eq, sql } from "drizzle-orm";
import { headers } from "next/headers";
import { auditDb } from "@/db/audit-index";
import {
  auditBusinesses,
  auditProspects,
  gbpAuditReports,
  gbpAudits,
  gbpReportAccessLinks,
  gbpReportViews,
  gbpQuoteRequests,
} from "@/db/audit-schema";
import { dispatchAuditWebhookEvent } from "@/lib/gbp-audit/webhooks";
import { checkRateLimit, clientIpFromHeaders } from "@/lib/gbp-audit/rate-limit";
import { notifyAuditRoles } from "@/lib/gbp-audit/notify";
import { getAuditSettings } from "@/lib/gbp-audit/settings";
import { logAuditActivity } from "@/lib/gbp-audit/activity";

/**
 * PUBLIC — no Clerk session, no audit staff role. This is the ONLY
 * server-side entry point the token portal route is allowed to call.
 * Possession of a valid, non-expired, non-revoked token (within the
 * attempt budget) is the sole credential — see db/audit-schema.ts on
 * gbpReportAccessLinks and the RLS notes in db/audit-migrations/.
 */
export async function resolveReportByToken(token: string) {
  const hdrs = await headers();
  const ip = clientIpFromHeaders(hdrs);

  // Generous default for a legit prospect reloading, throttling enough to
  // make token-guessing impractical — window fixed at 5 minutes, the limit
  // itself is admin-configurable (Paramètres → Sécurité).
  const settings = await getAuditSettings();
  const rate = await checkRateLimit("portal_token", ip, settings.rateLimitPortalViewsPerWindow, 300);
  if (!rate.allowed) return { ok: false as const, reason: "rate_limited" as const, retryAfterSeconds: rate.retryAfterSeconds };

  const [link] = await auditDb.select().from(gbpReportAccessLinks).where(eq(gbpReportAccessLinks.token, token)).limit(1);

  // No row at all — most brute-force guesses land here. There's no link to
  // attach a failed-attempt count to; the IP-level rate limit above is what
  // actually blunts this case.
  if (!link) return { ok: false as const, reason: "not_found" as const };

  if (link.failedAttempts >= link.maxAttempts) return { ok: false as const, reason: "locked" as const };

  // Token resolves to a real link, but it's no longer usable — count this
  // as a failed attempt against THIS link. Repeated probing of a
  // revoked/expired token (e.g. after access was intentionally cut off)
  // eventually locks it out entirely, on top of the IP-level throttle.
  async function recordFailure(reason: "revoked" | "expired") {
    await auditDb.update(gbpReportAccessLinks).set({ failedAttempts: sql`${gbpReportAccessLinks.failedAttempts} + 1` }).where(eq(gbpReportAccessLinks.id, link.id));
    return { ok: false as const, reason };
  }

  if (link.revokedAt) return recordFailure("revoked");
  if (link.expiresAt && link.expiresAt.getTime() < Date.now()) return recordFailure("expired");

  const [row] = await auditDb
    .select()
    .from(gbpAuditReports)
    .innerJoin(gbpAudits, eq(gbpAuditReports.auditId, gbpAudits.id))
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .innerJoin(auditProspects, eq(gbpAudits.prospectId, auditProspects.id))
    .where(eq(gbpAuditReports.id, link.reportId))
    .limit(1);

  if (!row) return { ok: false as const, reason: "not_found" as const };

  const ipHash = createHash("sha256").update(ip).digest("hex");
  await auditDb.insert(gbpReportViews).values({
    accessLinkId: link.id,
    ipHash,
    userAgent: hdrs.get("user-agent") ?? null,
  });

  return {
    ok: true as const,
    report: row.gbp_audit_reports,
    audit: row.gbp_audits,
    business: row.audit_businesses,
    prospect: row.audit_prospects,
  };
}

export async function submitPortalQuoteRequest(auditId: string, serviceOfferId: string | null, message: string) {
  const hdrs = await headers();
  const ip = clientIpFromHeaders(hdrs);

  // A real prospect submits this once or twice; anything beyond that from
  // one IP is spam, not legitimate use — window fixed at 1 hour, the limit
  // itself is admin-configurable (Paramètres → Sécurité).
  const settings = await getAuditSettings();
  const rate = await checkRateLimit("portal_quote_request", ip, settings.rateLimitQuoteRequestsPerHour, 3600);
  if (!rate.allowed) throw new Error("Trop de demandes envoyées. Réessayez plus tard.");

  // The FK on gbpQuoteRequests.auditId would already reject a nonexistent
  // audit at the DB level, but with a raw Postgres constraint-violation
  // message — check first so a stale/tampered portal page state gets a
  // clean error instead.
  const [businessRow] = await auditDb
    .select({ legalName: auditBusinesses.legalName, prospectId: gbpAudits.prospectId })
    .from(gbpAudits)
    .innerJoin(auditBusinesses, eq(gbpAudits.businessId, auditBusinesses.id))
    .where(eq(gbpAudits.id, auditId))
    .limit(1);
  if (!businessRow) throw new Error("Cet audit est introuvable.");

  const [quote] = await auditDb.insert(gbpQuoteRequests).values({ auditId, serviceOfferId, message: message || null }).returning();
  await dispatchAuditWebhookEvent("gbp_audit.quote_requested", { auditId, quoteId: quote.id });

  // No actor: submitted anonymously from the public portal, not by a staff
  // member — logAuditActivity resolves actorUserId from getAuditStaffSession(),
  // which is null here, so the row is correctly logged without one.
  // targetId is the quote itself (matches the report_access_link_created /
  // competitor_added convention of pointing at the entity just created);
  // metadata carries only auditId + prospectId, the two ids needed to
  // resolve this to the right audit's timeline — never the message body.
  await logAuditActivity({
    action: "quote_request_created",
    targetType: "gbp_quote_request",
    targetId: quote.id,
    metadata: { auditId, prospectId: businessRow.prospectId },
  });

  if (settings.notifyOnQuoteRequest) {
    await notifyAuditRoles(["admin", "supervisor"], {
      kind: "quote_request",
      title: "Nouvelle demande de devis",
      body: businessRow ? `${businessRow.legalName} a demandé un devis.` : null,
      href: "/admin/audit/devis",
    });
  }

  return quote;
}
