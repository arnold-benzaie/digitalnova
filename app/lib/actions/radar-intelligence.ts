"use server";

/**
 * RADAR INTELLIGENCE V1 — Slice 5 — the opt-in AI advisory server action.
 *
 * The ONLY thing the UI calls. It is:
 *  - server-authoritative: requireStaffMember("RADAR_QUEUE_VIEW") is the
 *    FIRST statement (the exact capability the RADAR queue read already
 *    needs — OWNER / ADMIN / MANAGER / EMPLOYEE; no new permission).
 *  - opt-in only: runs solely on an explicit user click. Nothing calls it
 *    on page load, per prospect, or in the background.
 *  - provider-optional: with no configured/enabled provider it returns
 *    { status: "unavailable" } — never a RADAR error.
 *  - non-authoritative: the advisory is text; it changes no priority /
 *    score / qualification / assignee / queue order / follow-up, and
 *    triggers no CRM mutation, email, telephony, or n8n.
 *
 * The deterministic basis comes verbatim from the existing authoritative
 * engine (lib/actions/radar.ts::getProspectQualification -> lib/radar/
 * score.ts). Provider selection is the configured registry's job; the
 * result never names it. No api key / model / provider / workspace / staff
 * id is accepted from the caller or returned.
 */
import { and, desc, eq, inArray, isNotNull, sql } from "drizzle-orm";
import { db } from "@/db";
import { crmClients, interactions, tasks } from "@/db/schema";
import { requireStaffMember } from "@/lib/rbac/require-staff-member";
import { requireSession } from "@/lib/session";
import { getProspectQualification } from "@/lib/actions/radar";
import { createConfiguredRadarIntelligenceRegistry } from "@/lib/radar-intelligence/configured-registry";
import { produceRadarAdvisory, type AdvisoryDisplayContext, type RadarAdvisoryUiResult } from "@/lib/radar-intelligence/advisory-core";

/** Small, best-effort anti-spam: one advisory per user per window, per
 * server instance. In-memory ONLY — no Redis, no DB schema. The UI button
 * lock is the primary guard; this backstops a scripted caller. */
const ADVISORY_COOLDOWN_MS = 8_000;
const lastAdvisoryRequestByUser = new Map<string, number>();

const OPEN_TASK_STATUSES = ["todo", "in_progress"] as const;
const RECENT_SUMMARY_LIMIT = 3;

function locationLabel(row: { city: string | null; region: string | null; country: string | null }): string | null {
  const parts = [row.city, row.region, row.country].filter((p): p is string => typeof p === "string" && p.trim().length > 0);
  return parts.length > 0 ? parts.join(", ") : null;
}

async function loadDisplayContext(clientId: string): Promise<AdvisoryDisplayContext | null> {
  const [client] = await db
    .select({
      name: crmClients.name,
      industry: crmClients.industry,
      city: crmClients.city,
      region: crmClients.region,
      country: crmClients.country,
      stage: crmClients.stage,
    })
    .from(crmClients)
    .where(eq(crmClients.id, clientId))
    .limit(1);
  if (!client) return null;

  const recent = await db
    .select({ summary: interactions.summary })
    .from(interactions)
    .where(eq(interactions.clientId, clientId))
    .orderBy(desc(interactions.occurredAt))
    .limit(RECENT_SUMMARY_LIMIT);

  const [openFollowUps] = await db
    .select({ value: sql<number>`count(*)` })
    .from(tasks)
    .where(and(eq(tasks.clientId, clientId), isNotNull(tasks.dueDate), inArray(tasks.status, OPEN_TASK_STATUSES)));

  return {
    name: client.name,
    sector: client.industry,
    location: locationLabel(client),
    stage: client.stage,
    recentInteractionSummaries: recent.map((r) => r.summary),
    openFollowUpCount: Number(openFollowUps?.value ?? 0),
  };
}

export async function requestRadarIntelligenceAdvisory(clientId: string): Promise<RadarAdvisoryUiResult> {
  await requireStaffMember("RADAR_QUEUE_VIEW");

  const { userId } = await requireSession();
  const now = Date.now();
  const last = lastAdvisoryRequestByUser.get(userId);
  if (typeof last === "number" && now - last < ADVISORY_COOLDOWN_MS) {
    return { status: "rate_limited" };
  }
  lastAdvisoryRequestByUser.set(userId, now);

  return produceRadarAdvisory(clientId, {
    loadQualification: getProspectQualification,
    loadDisplayContext,
    createRegistry: createConfiguredRadarIntelligenceRegistry,
  });
}
