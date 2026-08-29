"use server";

import { sql } from "drizzle-orm";
import { db } from "@/db";
import { requireStaffRole } from "@/lib/dev-role";

// AI Commercial Radar / Phase 1G-B — the frozen Phase 1G-A.1 analytics
// contract, implemented as bounded, deterministic, database-side
// aggregate SQL. Raw `sql` + db.execute() is used deliberately throughout
// (rather than the typed query builder) because several of these queries
// depend on constructs (correlated EXISTS with FILTER, CTEs,
// PERCENTILE_CONT ordered-set aggregates) that the query builder does not
// express cleanly, and the frozen contract's exact wording is easiest to
// audit against literal SQL. No row is ever loaded into JavaScript for
// per-row processing — every number below is computed by Postgres itself.
//
// ALL-TIME ONLY. No date-range parameter exists, deliberately (see
// Phase 1G-A.1's TIME FILTER CONTRACT: several metrics here, notably deal
// win rate and client conversion rate, have no honest transition
// timestamp to filter by — a partial date-filter contract would silently
// mislead).

export type RateResult = { value: number | null; numerator: number; denominator: number };
export type DurationResult = { avgDays: number | null; medianDays: number | null; unit: "days"; sampleSize: number };
export type MoneyByCurrency = { currency: string; amountCents: number };

export type CommercialAnalyticsSnapshot = {
  volume: {
    uniqueProspectsContacted: number;
    contactAttempts: number;
    outboundCalls: number;
    outboundEmails: number;
  };
  responses: {
    inboundEvents: number;
    uniqueRespondingProspectsAny: number;
    responseRate: RateResult;
    positiveResponseRateOfContacted: RateResult;
    positiveResponseRateOfResponders: RateResult;
    negativeResponseRateOfContacted: RateResult;
    negativeResponseRateOfResponders: RateResult;
  };
  meetings: {
    heldEvents: number;
    uniqueProspectsWithMeeting: number;
    meetingRate: RateResult;
  };
  proposals: {
    sentDocuments: number;
    sentUniqueClients: number;
    acceptedDocuments: number;
    acceptedUniqueClients: number;
    declinedDocuments: number;
    declinedUniqueClients: number;
  };
  deals: {
    dealWinRate: RateResult;
    clientConversionRate: RateResult;
  };
  payments: {
    payingClientCount: number;
    payingClientRateOfContacted: RateResult;
    grossCollectedRevenue: MoneyByCurrency[];
    refundedRevenue: MoneyByCurrency[];
  };
  timing: {
    timeToFirstContact: DurationResult;
    timeToFirstResponse: DurationResult;
    createdToFirstPaid: DurationResult;
  };
  dataQuality: {
    hasLegacyInteractionData: boolean;
    feedbackTrackingStartedAt: string | null;
    anomalousNegativeDurationCounts: {
      timeToFirstContact: number;
      timeToFirstResponse: number;
      createdToFirstPaid: number;
    };
  };
};

function toRate(numerator: number, denominator: number): RateResult {
  return { value: denominator > 0 ? numerator / denominator : null, numerator, denominator };
}

function toDuration(sampleSize: number, avgDays: number | null, medianDays: number | null): DurationResult {
  return {
    avgDays: sampleSize > 0 ? avgDays : null,
    medianDays: sampleSize > 0 ? medianDays : null,
    unit: "days",
    sampleSize,
  };
}

type DurationRow = { sample_size: number; avg_days: number | null; median_days: number | null; anomaly_count: number };

// Single pass over `interactions` — volume, raw response/meeting counts,
// and data-quality legacy detection all come from the same table scan.
async function getInteractionsSummary() {
  const result = await db.execute<{
    unique_contacted: number;
    contact_attempts: number;
    outbound_calls: number;
    outbound_emails: number;
    inbound_events: number;
    unique_responding_any: number;
    meeting_held_events: number;
    unique_with_meeting: number;
    has_legacy: boolean | null;
    feedback_tracking_started_at: string | Date | null;
  }>(sql`
    SELECT
      COUNT(DISTINCT client_id) FILTER (WHERE direction = 'outbound')::int AS unique_contacted,
      COUNT(*) FILTER (WHERE direction = 'outbound')::int AS contact_attempts,
      COUNT(*) FILTER (WHERE type = 'call' AND direction = 'outbound')::int AS outbound_calls,
      COUNT(*) FILTER (WHERE type = 'email' AND direction = 'outbound')::int AS outbound_emails,
      COUNT(*) FILTER (WHERE direction = 'inbound')::int AS inbound_events,
      COUNT(DISTINCT client_id) FILTER (WHERE direction = 'inbound')::int AS unique_responding_any,
      COUNT(*) FILTER (WHERE type = 'meeting')::int AS meeting_held_events,
      COUNT(DISTINCT client_id) FILTER (WHERE type = 'meeting')::int AS unique_with_meeting,
      bool_or(direction IS NULL) AS has_legacy,
      MIN(created_at) FILTER (WHERE direction IS NOT NULL) AS feedback_tracking_started_at
    FROM interactions
  `);
  return result.rows[0];
}

// Requires the temporal-ordering rule (strict > first outbound) shared by
// response rate, positive/negative response rate, and meeting rate.
async function getContactedOutcomeCounts() {
  const result = await db.execute<{
    contacted_denominator: number;
    response_numerator: number;
    positive_numerator: number;
    negative_numerator: number;
    meeting_numerator: number;
  }>(sql`
    WITH first_outbound AS (
      SELECT client_id, MIN(occurred_at) AS first_outbound_at
      FROM interactions
      WHERE direction = 'outbound'
      GROUP BY client_id
    )
    SELECT
      COUNT(*)::int AS contacted_denominator,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM interactions i
        WHERE i.client_id = fo.client_id AND i.direction = 'inbound' AND i.occurred_at > fo.first_outbound_at
      ))::int AS response_numerator,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM interactions i
        WHERE i.client_id = fo.client_id AND i.direction = 'inbound' AND i.occurred_at > fo.first_outbound_at AND i.outcome = 'positive'
      ))::int AS positive_numerator,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM interactions i
        WHERE i.client_id = fo.client_id AND i.direction = 'inbound' AND i.occurred_at > fo.first_outbound_at AND i.outcome = 'negative'
      ))::int AS negative_numerator,
      COUNT(*) FILTER (WHERE EXISTS (
        SELECT 1 FROM interactions i
        WHERE i.client_id = fo.client_id AND i.type = 'meeting' AND i.occurred_at > fo.first_outbound_at
      ))::int AS meeting_numerator
    FROM first_outbound fo
  `);
  return result.rows[0];
}

async function getProposalCounts() {
  const result = await db.execute<{
    sent_documents: number;
    sent_unique_clients: number;
    accepted_documents: number;
    accepted_unique_clients: number;
    declined_documents: number;
    declined_unique_clients: number;
  }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE sent_at IS NOT NULL)::int AS sent_documents,
      COUNT(DISTINCT client_id) FILTER (WHERE sent_at IS NOT NULL)::int AS sent_unique_clients,
      COUNT(*) FILTER (WHERE status = 'accepted')::int AS accepted_documents,
      COUNT(DISTINCT client_id) FILTER (WHERE status = 'accepted')::int AS accepted_unique_clients,
      COUNT(*) FILTER (WHERE status = 'declined')::int AS declined_documents,
      COUNT(DISTINCT client_id) FILTER (WHERE status = 'declined')::int AS declined_unique_clients
    FROM crm_quotes
  `);
  return result.rows[0];
}

async function getDealCounts() {
  const result = await db.execute<{ won: number; concluded: number }>(sql`
    SELECT
      COUNT(*) FILTER (WHERE stage = 'won')::int AS won,
      COUNT(*) FILTER (WHERE stage IN ('won', 'lost'))::int AS concluded
    FROM deals
  `);
  return result.rows[0];
}

// Intersection-safe numerators (guaranteed subset of the contacted
// population) for client conversion and paying-client rate, plus the
// plain paying-client count — all reuse the same `direction='outbound'`
// contacted population as the rate denominators above.
async function getClientOutcomeNumerators() {
  const result = await db.execute<{
    won_client_numerator: number;
    paying_client_numerator: number;
    paying_client_count: number;
  }>(sql`
    SELECT
      (
        SELECT COUNT(DISTINCT i.client_id)::int
        FROM interactions i
        WHERE i.direction = 'outbound'
          AND i.client_id IN (SELECT client_id FROM deals WHERE stage = 'won')
      ) AS won_client_numerator,
      (
        SELECT COUNT(DISTINCT i.client_id)::int
        FROM interactions i
        WHERE i.direction = 'outbound'
          AND i.client_id IN (SELECT client_id FROM crm_invoices WHERE paid_at IS NOT NULL AND client_id IS NOT NULL)
      ) AS paying_client_numerator,
      (
        SELECT COUNT(DISTINCT client_id)::int
        FROM crm_invoices
        WHERE paid_at IS NOT NULL AND client_id IS NOT NULL
      ) AS paying_client_count
  `);
  return result.rows[0];
}

async function getRevenueByCurrency(): Promise<MoneyByCurrency[]> {
  const result = await db.execute<{ currency: string; amount_cents: number }>(sql`
    SELECT currency, SUM(total_cents)::int AS amount_cents
    FROM crm_invoices
    WHERE paid_at IS NOT NULL
    GROUP BY currency
  `);
  return result.rows.map((r) => ({ currency: r.currency, amountCents: Number(r.amount_cents) }));
}

async function getRefundedRevenueByCurrency(): Promise<MoneyByCurrency[]> {
  const result = await db.execute<{ currency: string; amount_cents: number }>(sql`
    SELECT currency, SUM(total_cents)::int AS amount_cents
    FROM crm_invoices
    WHERE paid_at IS NOT NULL AND status = 'refunded'
    GROUP BY currency
  `);
  return result.rows.map((r) => ({ currency: r.currency, amountCents: Number(r.amount_cents) }));
}

async function getTimeToFirstContact(): Promise<DurationRow> {
  const result = await db.execute<DurationRow>(sql`
    WITH first_contact AS (
      SELECT c.id AS client_id, c.created_at, MIN(i.occurred_at) AS first_outbound_at
      FROM crm_clients c
      JOIN interactions i ON i.client_id = c.id AND i.direction = 'outbound'
      GROUP BY c.id, c.created_at
    ),
    durations AS (
      SELECT EXTRACT(EPOCH FROM (first_outbound_at - created_at)) / 86400.0 AS duration_days
      FROM first_contact
    )
    SELECT
      (SELECT COUNT(*)::int FROM durations WHERE duration_days >= 0) AS sample_size,
      (SELECT AVG(duration_days)::float8 FROM durations WHERE duration_days >= 0) AS avg_days,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_days)::float8 FROM durations WHERE duration_days >= 0) AS median_days,
      (SELECT COUNT(*)::int FROM durations WHERE duration_days < 0) AS anomaly_count
  `);
  return result.rows[0];
}

// Structurally, duration_days here can never be negative (the inner
// subquery only selects inbound rows with occurred_at strictly greater
// than first_outbound_at) — the anomaly branch is kept anyway, for
// defense-in-depth and contract symmetry with the other two timing
// queries, not because a negative value is expected here.
async function getTimeToFirstResponse(): Promise<DurationRow> {
  const result = await db.execute<DurationRow>(sql`
    WITH first_outbound AS (
      SELECT client_id, MIN(occurred_at) AS first_outbound_at
      FROM interactions
      WHERE direction = 'outbound'
      GROUP BY client_id
    ),
    first_response AS (
      SELECT
        fo.client_id,
        fo.first_outbound_at,
        (
          SELECT MIN(i.occurred_at) FROM interactions i
          WHERE i.client_id = fo.client_id AND i.direction = 'inbound' AND i.occurred_at > fo.first_outbound_at
        ) AS first_inbound_after
      FROM first_outbound fo
    ),
    durations AS (
      SELECT EXTRACT(EPOCH FROM (first_inbound_after - first_outbound_at)) / 86400.0 AS duration_days
      FROM first_response
      WHERE first_inbound_after IS NOT NULL
    )
    SELECT
      (SELECT COUNT(*)::int FROM durations WHERE duration_days >= 0) AS sample_size,
      (SELECT AVG(duration_days)::float8 FROM durations WHERE duration_days >= 0) AS avg_days,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_days)::float8 FROM durations WHERE duration_days >= 0) AS median_days,
      (SELECT COUNT(*)::int FROM durations WHERE duration_days < 0) AS anomaly_count
  `);
  return result.rows[0];
}

async function getCreatedToFirstPaid(): Promise<DurationRow> {
  const result = await db.execute<DurationRow>(sql`
    WITH first_paid AS (
      SELECT c.id AS client_id, c.created_at, MIN(inv.paid_at) AS first_paid_at
      FROM crm_clients c
      JOIN crm_invoices inv ON inv.client_id = c.id AND inv.paid_at IS NOT NULL
      GROUP BY c.id, c.created_at
    ),
    durations AS (
      SELECT EXTRACT(EPOCH FROM (first_paid_at - created_at)) / 86400.0 AS duration_days
      FROM first_paid
    )
    SELECT
      (SELECT COUNT(*)::int FROM durations WHERE duration_days >= 0) AS sample_size,
      (SELECT AVG(duration_days)::float8 FROM durations WHERE duration_days >= 0) AS avg_days,
      (SELECT PERCENTILE_CONT(0.5) WITHIN GROUP (ORDER BY duration_days)::float8 FROM durations WHERE duration_days >= 0) AS median_days,
      (SELECT COUNT(*)::int FROM durations WHERE duration_days < 0) AS anomaly_count
  `);
  return result.rows[0];
}

export async function getCommercialAnalytics(): Promise<CommercialAnalyticsSnapshot> {
  await requireStaffRole();

  const [
    interactionsSummary,
    contactedOutcomes,
    proposalCounts,
    dealCounts,
    clientOutcomeNumerators,
    grossRevenue,
    refundedRevenue,
    timeToFirstContact,
    timeToFirstResponse,
    createdToFirstPaid,
  ] = await Promise.all([
    getInteractionsSummary(),
    getContactedOutcomeCounts(),
    getProposalCounts(),
    getDealCounts(),
    getClientOutcomeNumerators(),
    getRevenueByCurrency(),
    getRefundedRevenueByCurrency(),
    getTimeToFirstContact(),
    getTimeToFirstResponse(),
    getCreatedToFirstPaid(),
  ]);

  const uniqueProspectsContacted = interactionsSummary.unique_contacted;

  return {
    volume: {
      uniqueProspectsContacted,
      contactAttempts: interactionsSummary.contact_attempts,
      outboundCalls: interactionsSummary.outbound_calls,
      outboundEmails: interactionsSummary.outbound_emails,
    },
    responses: {
      inboundEvents: interactionsSummary.inbound_events,
      uniqueRespondingProspectsAny: interactionsSummary.unique_responding_any,
      responseRate: toRate(contactedOutcomes.response_numerator, contactedOutcomes.contacted_denominator),
      positiveResponseRateOfContacted: toRate(contactedOutcomes.positive_numerator, contactedOutcomes.contacted_denominator),
      positiveResponseRateOfResponders: toRate(contactedOutcomes.positive_numerator, contactedOutcomes.response_numerator),
      negativeResponseRateOfContacted: toRate(contactedOutcomes.negative_numerator, contactedOutcomes.contacted_denominator),
      negativeResponseRateOfResponders: toRate(contactedOutcomes.negative_numerator, contactedOutcomes.response_numerator),
    },
    meetings: {
      heldEvents: interactionsSummary.meeting_held_events,
      uniqueProspectsWithMeeting: interactionsSummary.unique_with_meeting,
      meetingRate: toRate(contactedOutcomes.meeting_numerator, contactedOutcomes.contacted_denominator),
    },
    proposals: {
      sentDocuments: proposalCounts.sent_documents,
      sentUniqueClients: proposalCounts.sent_unique_clients,
      acceptedDocuments: proposalCounts.accepted_documents,
      acceptedUniqueClients: proposalCounts.accepted_unique_clients,
      declinedDocuments: proposalCounts.declined_documents,
      declinedUniqueClients: proposalCounts.declined_unique_clients,
    },
    deals: {
      dealWinRate: toRate(dealCounts.won, dealCounts.concluded),
      clientConversionRate: toRate(clientOutcomeNumerators.won_client_numerator, uniqueProspectsContacted),
    },
    payments: {
      payingClientCount: clientOutcomeNumerators.paying_client_count,
      payingClientRateOfContacted: toRate(clientOutcomeNumerators.paying_client_numerator, uniqueProspectsContacted),
      grossCollectedRevenue: grossRevenue,
      refundedRevenue: refundedRevenue,
    },
    timing: {
      timeToFirstContact: toDuration(timeToFirstContact.sample_size, timeToFirstContact.avg_days, timeToFirstContact.median_days),
      timeToFirstResponse: toDuration(timeToFirstResponse.sample_size, timeToFirstResponse.avg_days, timeToFirstResponse.median_days),
      createdToFirstPaid: toDuration(createdToFirstPaid.sample_size, createdToFirstPaid.avg_days, createdToFirstPaid.median_days),
    },
    dataQuality: {
      hasLegacyInteractionData: Boolean(interactionsSummary.has_legacy),
      feedbackTrackingStartedAt: interactionsSummary.feedback_tracking_started_at
        ? new Date(interactionsSummary.feedback_tracking_started_at).toISOString()
        : null,
      anomalousNegativeDurationCounts: {
        timeToFirstContact: timeToFirstContact.anomaly_count,
        timeToFirstResponse: timeToFirstResponse.anomaly_count,
        createdToFirstPaid: createdToFirstPaid.anomaly_count,
      },
    },
  };
}
