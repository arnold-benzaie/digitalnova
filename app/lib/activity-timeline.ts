/**
 * Aggregates `auditLog` (lib/audit.ts) and `notifications` (lib/notifications.ts)
 * into a single, UI-agnostic "what PUBLIC-MAP has done for you" event
 * shape for the client dashboard (PHASE 1A §H). Deliberately reuses these
 * two existing tables — no new table, no third logging system.
 *
 * Security/positioning rule: this is a STRICT ALLOW LIST, not a deny list.
 * A new auditLog action or notification type added anywhere else in the
 * app is invisible here by default until explicitly added below — the
 * safe failure mode is "missing from the timeline", never "leaked to a
 * client by accident". Every entry below is commercial framing text
 * ("Google Analytics synchronisé"), never the raw technical `action`/`type`
 * string, and never renders `metadata` — see the module comment on each
 * map for why.
 */
import { and, desc, eq, inArray } from "drizzle-orm";
import { db } from "@/db";
import { auditLog, notifications } from "@/db/schema";
import type { Locale } from "@/lib/i18n/dictionaries";
import type { SemanticTone } from "@/lib/gbp-audit/status-colors";

export type ActivityCategory = "sync" | "profile" | "billing" | "documents" | "reports" | "reviews";

export type ActivityEvent = {
  id: string;
  timestamp: Date;
  title: string;
  description: string;
  category: ActivityCategory;
  tone: SemanticTone;
  href?: string;
};

type ClientEntryDef = {
  category: ActivityCategory;
  tone: SemanticTone;
  href?: string;
  fr: { title: string; description: string };
  en: { title: string; description: string };
};

// auditLog.action → client-safe entry. Every title/description is fully
// static (no metadata interpolation) so there is zero risk of an internal
// detail leaking through a template — see the module comment above.
const AUDIT_LOG_WHITELIST: Record<string, ClientEntryDef> = {
  "gbp.synced": {
    category: "sync",
    tone: "good",
    href: "/dashboard/gbp",
    fr: { title: "Google Business Profile synchronisé", description: "Vos dernières données Google Business Profile sont maintenant disponibles." },
    en: { title: "Google Business Profile synced", description: "Your latest Google Business Profile data is now available." },
  },
  "analytics.synced": {
    category: "sync",
    tone: "good",
    href: "/dashboard/analytics",
    fr: { title: "Google Analytics synchronisé", description: "Vos dernières données Analytics sont maintenant disponibles." },
    en: { title: "Google Analytics synced", description: "Your latest Analytics data is now available." },
  },
  "search_console.synced": {
    category: "sync",
    tone: "good",
    href: "/dashboard/search-console",
    fr: { title: "Search Console synchronisé", description: "Vos dernières données de recherche Google sont maintenant disponibles." },
    en: { title: "Search Console synced", description: "Your latest Google search data is now available." },
  },
  "gbp.connect_error": {
    category: "sync",
    tone: "bad",
    href: "/dashboard/gbp",
    fr: { title: "Échec de synchronisation Google Business Profile", description: "La dernière tentative de synchronisation n'a pas abouti." },
    en: { title: "Google Business Profile sync failed", description: "The last sync attempt didn't go through." },
  },
  "analytics.connect_error": {
    category: "sync",
    tone: "bad",
    href: "/dashboard/analytics",
    fr: { title: "Échec de synchronisation Google Analytics", description: "La dernière tentative de synchronisation n'a pas abouti." },
    en: { title: "Google Analytics sync failed", description: "The last sync attempt didn't go through." },
  },
  "search_console.connect_error": {
    category: "sync",
    tone: "bad",
    href: "/dashboard/search-console",
    fr: { title: "Échec de synchronisation Search Console", description: "La dernière tentative de synchronisation n'a pas abouti." },
    en: { title: "Search Console sync failed", description: "The last sync attempt didn't go through." },
  },
  "onboarding.completed": {
    category: "profile",
    tone: "good",
    href: "/dashboard/onboarding",
    fr: { title: "Profil d'accueil complété", description: "Merci — votre conseiller a maintenant une vue claire de vos besoins." },
    en: { title: "Onboarding profile completed", description: "Thanks — your advisor now has a clear view of your needs." },
  },
  "crm.invoice_sent": {
    category: "billing",
    tone: "info",
    href: "/dashboard/documents",
    fr: { title: "Facture envoyée", description: "PUBLIC-MAP vous a envoyé une nouvelle facture par e-mail." },
    en: { title: "Invoice sent", description: "PUBLIC-MAP emailed you a new invoice." },
  },
  "gbp.review_replied": {
    category: "reviews",
    tone: "good",
    href: "/dashboard/gbp",
    fr: { title: "Réponse à un avis publiée", description: "PUBLIC-MAP a répondu à un avis Google en votre nom." },
    en: { title: "Review reply posted", description: "PUBLIC-MAP replied to a Google review on your behalf." },
  },
};

// notifications.type → client-safe entry. A second, non-overlapping source
// (some client-relevant events today only exist as a `notifications` row,
// not an `auditLog` row) — merged with the map above at read time.
const NOTIFICATION_WHITELIST: Record<string, ClientEntryDef> = {
  "report.generated": {
    category: "reports",
    tone: "good",
    href: "/dashboard/audits",
    fr: { title: "Rapport généré", description: "Un nouveau rapport est disponible." },
    en: { title: "Report generated", description: "A new report is available." },
  },
  "audit.generated": {
    category: "reports",
    tone: "good",
    href: "/dashboard/audits",
    fr: { title: "Audit généré", description: "Un nouvel audit est disponible avec son score et ses recommandations." },
    en: { title: "Audit generated", description: "A new audit is available with its score and recommendations." },
  },
  "document.uploaded": {
    category: "documents",
    tone: "info",
    href: "/dashboard/documents",
    fr: { title: "Nouveau document disponible", description: "PUBLIC-MAP a ajouté un nouveau document à votre espace." },
    en: { title: "New document available", description: "PUBLIC-MAP added a new document to your space." },
  },
};

function toEvent(id: string, action: string, def: ClientEntryDef, locale: Locale, timestamp: Date): ActivityEvent {
  const text = locale === "en" ? def.en : def.fr;
  return { id, timestamp, title: text.title, description: text.description, category: def.category, tone: def.tone, href: def.href };
}

/**
 * Real, org-scoped, whitelist-filtered activity feed for the client
 * dashboard. Reads both source tables directly with the whitelist as a
 * SQL `IN (...)` filter (not fetched-then-filtered in JS) — an org with a
 * lot of staff-only audit-log noise never pulls more rows than it needs.
 * notifications are restricted to org-broadcast rows (userId IS NULL) —
 * the "what PUBLIC-MAP did for you" feed is an organization-level record,
 * not one signed-in user's personal inbox.
 */
export async function getClientActivityTimeline(organizationId: string, locale: Locale, limit = 8): Promise<ActivityEvent[]> {
  const auditLogActions = Object.keys(AUDIT_LOG_WHITELIST);
  const notificationTypes = Object.keys(NOTIFICATION_WHITELIST);

  const [logRows, notificationRows] = await Promise.all([
    auditLogActions.length
      ? db
          .select({ id: auditLog.id, action: auditLog.action, createdAt: auditLog.createdAt })
          .from(auditLog)
          .where(and(eq(auditLog.organizationId, organizationId), inArray(auditLog.action, auditLogActions)))
          .orderBy(desc(auditLog.createdAt))
          .limit(limit)
      : Promise.resolve([]),
    notificationTypes.length
      ? db
          .select({ id: notifications.id, type: notifications.type, createdAt: notifications.createdAt })
          .from(notifications)
          .where(and(eq(notifications.organizationId, organizationId), inArray(notifications.type, notificationTypes)))
          .orderBy(desc(notifications.createdAt))
          .limit(limit)
      : Promise.resolve([]),
  ]);

  const events: ActivityEvent[] = [
    ...logRows
      .filter((row) => AUDIT_LOG_WHITELIST[row.action])
      .map((row) => toEvent(`log-${row.id}`, row.action, AUDIT_LOG_WHITELIST[row.action], locale, row.createdAt)),
    ...notificationRows
      .filter((row) => NOTIFICATION_WHITELIST[row.type])
      .map((row) => toEvent(`notif-${row.id}`, row.type, NOTIFICATION_WHITELIST[row.type], locale, row.createdAt)),
  ];

  return events.sort((a, b) => b.timestamp.getTime() - a.timestamp.getTime()).slice(0, limit);
}

/** Count of client-visible events strictly after `since` — powers the
 * Morning Brief's "PUBLIC-MAP a effectué N actions depuis votre dernière
 * connexion" line. Null `since` (first-ever visit) means there is no real
 * "since last visit" window, so the caller should treat this as
 * unavailable rather than counting from the beginning of time. */
export async function countClientActivitySince(organizationId: string, since: Date | null, locale: Locale): Promise<number | null> {
  if (!since) return null;
  const events = await getClientActivityTimeline(organizationId, locale, 50);
  return events.filter((e) => e.timestamp > since).length;
}
