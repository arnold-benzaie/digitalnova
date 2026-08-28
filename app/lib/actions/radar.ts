"use server";

import { eq } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, crmInvoices, crmQuotes, deals, interactions } from "@/db/schema";
import { requireStaffRole } from "@/lib/dev-role";
import { assessQualification, type Eligibility, type QualificationStatus } from "@/lib/radar/qualification";
import { assessOpportunity, type Confidence, type Priority } from "@/lib/radar/score";

export type ProspectQualificationResult = {
  qualificationStatus: QualificationStatus;
  eligibility: Eligibility;
  // null whenever qualificationStatus !== "QUALIFIED" — the opportunity
  // engine (lib/radar/score.ts) is never invoked for a prospect that
  // hasn't passed qualification/eligibility, per the Phase 1C design: a
  // doNotContact/archived/insufficient-data prospect's deal/quote/
  // interaction/invoice history isn't even fetched, let alone scored.
  opportunity: null | {
    priority: Priority;
    confidence: Confidence;
    reasons: string[];
    recommendedNextAction: string;
  };
};

/**
 * AI Commercial Radar / Phase 1C — read-only prospect qualification +
 * (when applicable) opportunity assessment for one CRM client. Dynamic
 * computation only (Option A from the Phase 1C design audit): no new
 * table, no persistence, no mutation, no audit entry written merely for
 * reading. Reads only staff-global CRM data (crmClients, deals,
 * interactions, crmQuotes, crmInvoices) — never organization-scoped
 * client-portal data.
 */
export async function getProspectQualification(clientId: string): Promise<ProspectQualificationResult> {
  await requireStaffRole();

  const [client] = await db
    .select({
      name: crmClients.name,
      email: crmClients.email,
      phone: crmClients.phone,
      industry: crmClients.industry,
      country: crmClients.country,
      region: crmClients.region,
      city: crmClients.city,
      doNotContact: crmClients.doNotContact,
      archivedAt: crmClients.archivedAt,
      organizationId: crmClients.organizationId,
    })
    .from(crmClients)
    .where(eq(crmClients.id, clientId))
    .limit(1);

  if (!client) {
    throw new Error("Client not found.");
  }

  const qualification = assessQualification({
    name: client.name,
    email: client.email,
    phone: client.phone,
    doNotContact: client.doNotContact,
    archivedAt: client.archivedAt,
  });

  if (qualification.qualificationStatus !== "QUALIFIED") {
    return { ...qualification, opportunity: null };
  }

  const [clientDeals, clientInteractions, clientQuotes, clientInvoices] = await Promise.all([
    db.select({ stage: deals.stage }).from(deals).where(eq(deals.clientId, clientId)),
    db.select({ occurredAt: interactions.occurredAt }).from(interactions).where(eq(interactions.clientId, clientId)),
    db
      .select({ status: crmQuotes.status, sentAt: crmQuotes.sentAt, respondedAt: crmQuotes.respondedAt })
      .from(crmQuotes)
      .where(eq(crmQuotes.clientId, clientId)),
    db.select({ paidAt: crmInvoices.paidAt }).from(crmInvoices).where(eq(crmInvoices.clientId, clientId)),
  ]);

  const opportunity = assessOpportunity({
    industry: client.industry,
    country: client.country,
    region: client.region,
    city: client.city,
    organizationId: client.organizationId,
    deals: clientDeals,
    interactions: clientInteractions,
    quotes: clientQuotes,
    invoices: clientInvoices,
  });

  return { ...qualification, opportunity };
}
