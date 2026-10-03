import { and, gte, lt, sql } from "drizzle-orm";
import { auditDb } from "@/db/audit-index";
import { gbpAudits } from "@/db/audit-schema";

export {
  DASHBOARD_PERIOD_OPTIONS,
  isDashboardPeriodDays,
  daysAgo,
  buildAuditsOverTimeSeries,
} from "./dashboard-stats-core";
export type { DashboardPeriodDays } from "./dashboard-stats-core";

const DAY_MS = 24 * 60 * 60 * 1000;

export interface PeriodComparison {
  currentCount: number;
  previousCount: number;
  /** null when there's nothing to compare against (previousCount === 0) — never divide by zero into a fake percentage. */
  deltaPercent: number | null;
  direction: "up" | "down" | "flat";
}

/**
 * "Audits créés sur la période" — real count of gbpAudits.createdAt within
 * the last `days`, compared against the immediately preceding window of
 * the same duration. Both windows are computed from the same `now` so the
 * comparison is internally consistent even if the two queries run a few
 * milliseconds apart. Deliberately separate from the KPI tiles above,
 * which are at-date totals independent of the period selector.
 */
export async function getAuditsCreatedPeriodComparison(days: number): Promise<PeriodComparison> {
  const now = new Date();
  const currentStart = new Date(now.getTime() - days * DAY_MS);
  const previousStart = new Date(now.getTime() - 2 * days * DAY_MS);

  const [[{ count: currentCount }], [{ count: previousCount }]] = await Promise.all([
    auditDb.select({ count: sql<number>`count(*)::int` }).from(gbpAudits).where(gte(gbpAudits.createdAt, currentStart)),
    auditDb
      .select({ count: sql<number>`count(*)::int` })
      .from(gbpAudits)
      .where(and(gte(gbpAudits.createdAt, previousStart), lt(gbpAudits.createdAt, currentStart))),
  ]);

  if (previousCount === 0) {
    return { currentCount, previousCount, deltaPercent: null, direction: currentCount > 0 ? "up" : "flat" };
  }
  const deltaPercent = Math.round(((currentCount - previousCount) / previousCount) * 100);
  return { currentCount, previousCount, deltaPercent, direction: deltaPercent > 0 ? "up" : deltaPercent < 0 ? "down" : "flat" };
}

/**
 * Maps a real auditActivityLog row to a real route, using only targetType/
 * targetId/metadata shapes actually written by lib/actions/gbp-audit*.ts
 * (verified against every logAuditActivity() call site). Returns null
 * rather than guessing when a target type has no per-resource page or
 * isn't recognized — never a fabricated link.
 */
export function resolveActivityHref(targetType: string | null, targetId: string | null, metadata: unknown): string | null {
  const meta = (metadata && typeof metadata === "object" ? (metadata as Record<string, unknown>) : {}) as { auditId?: string };
  const auditId = typeof meta.auditId === "string" ? meta.auditId : null;

  switch (targetType) {
    case "gbp_audit":
      return targetId ? `/admin/audit/${targetId}` : null;
    case "gbp_audit_finding":
      return auditId ? `/admin/audit/${auditId}/audit` : null;
    case "gbp_correction_task":
      return auditId ? `/admin/audit/${auditId}/plan-correction` : null;
    case "gbp_audit_comments":
    case "audit_prospect":
    case "audit_businesses":
      return auditId ? `/admin/audit/${auditId}` : null;
    case "gbp_competitor":
      return auditId ? `/admin/audit/${auditId}/concurrence` : null;
    case "gbp_audit_evidence":
      return auditId ? `/admin/audit/${auditId}/preuves` : null;
    case "gbp_report_access_link":
      return auditId ? `/admin/audit/${auditId}/rapport` : null;
    case "gbp_quote_request":
    case "gbp_quote_requests":
      return "/admin/audit/devis";
    case "gbp_audit_settings":
      return "/admin/audit/parametres";
    case "gbp_service_offers":
      return "/admin/audit/offres";
    case "audit_staff_invitations":
    case "audit_staff_users":
      return "/admin/audit/equipe";
    default:
      return null;
  }
}

/**
 * Icon per activity type, grouped by the real action-name prefixes used
 * across lib/actions/gbp-audit*.ts (see lib/gbp-audit/activity-labels.ts
 * for the full real action list) — every prefix corresponds to real
 * logAuditActivity() call sites, none invented. Returns a NAV_ICONS key
 * (not the component itself, to avoid this data-layer file importing
 * from components/).
 */
export function activityIconNameFor(action: string): string {
  if (action.startsWith("settings_")) return "settings";
  if (action.startsWith("staff_")) return "users";
  if (action.startsWith("service_offer_")) return "tag";
  if (action.startsWith("quote_request_")) return "inbox";
  if (action.startsWith("correction_task_")) return "zap";
  if (action.startsWith("competitor_")) return "trendingUp";
  if (action.startsWith("business_profile_")) return "building";
  if (action.startsWith("evidence_")) return "folder";
  if (action.startsWith("comment_")) return "mail";
  if (action.startsWith("finding_")) return "checkSquare";
  if (action.startsWith("report_access_link_")) return "fileSignature";
  if (action === "prospect_created") return "userCircle";
  return "fileText";
}
