import {
  DEAL_STAGE_OPTIONS,
  DEAL_STAGE_OPTIONS_EN,
  PROJECT_STATUS_OPTIONS,
  PROJECT_STATUS_OPTIONS_EN,
  TASK_STATUS_OPTIONS,
  TASK_STATUS_OPTIONS_EN,
  TICKET_STATUS_OPTIONS,
  TICKET_STATUS_OPTIONS_EN,
} from "@/components/crm/badges";
import { INVOICE_STATUS_OPTIONS, INVOICE_STATUS_OPTIONS_EN, QUOTE_STATUS_OPTIONS, QUOTE_STATUS_OPTIONS_EN } from "@/lib/crm-billing";
import { SEO_ISSUE_STATUS_OPTIONS, SEO_ISSUE_STATUS_OPTIONS_EN } from "@/lib/seo-shared";
import type { Locale } from "@/lib/i18n/dictionaries";

const DEAL_STAGE_LABEL = Object.fromEntries(DEAL_STAGE_OPTIONS.map((o) => [o.value, o.label]));
const TICKET_STATUS_LABEL = Object.fromEntries(TICKET_STATUS_OPTIONS.map((o) => [o.value, o.label]));
const TASK_STATUS_LABEL = Object.fromEntries(TASK_STATUS_OPTIONS.map((o) => [o.value, o.label]));
const PROJECT_STATUS_LABEL = Object.fromEntries(PROJECT_STATUS_OPTIONS.map((o) => [o.value, o.label]));
const QUOTE_STATUS_LABEL = Object.fromEntries(QUOTE_STATUS_OPTIONS.map((o) => [o.value, o.label]));
const INVOICE_STATUS_LABEL = Object.fromEntries(INVOICE_STATUS_OPTIONS.map((o) => [o.value, o.label]));
const SEO_ISSUE_STATUS_LABEL = Object.fromEntries(SEO_ISSUE_STATUS_OPTIONS.map((o) => [o.value, o.label]));
const CLIENT_STAGE_LABEL: Record<string, string> = {
  lead: "Lead",
  prospect: "Prospect",
  client: "Client",
  churned: "Perdu",
};

const DEAL_STAGE_LABEL_EN = Object.fromEntries(DEAL_STAGE_OPTIONS_EN.map((o) => [o.value, o.label]));
const TICKET_STATUS_LABEL_EN = Object.fromEntries(TICKET_STATUS_OPTIONS_EN.map((o) => [o.value, o.label]));
const TASK_STATUS_LABEL_EN = Object.fromEntries(TASK_STATUS_OPTIONS_EN.map((o) => [o.value, o.label]));
const PROJECT_STATUS_LABEL_EN = Object.fromEntries(PROJECT_STATUS_OPTIONS_EN.map((o) => [o.value, o.label]));
const QUOTE_STATUS_LABEL_EN = Object.fromEntries(QUOTE_STATUS_OPTIONS_EN.map((o) => [o.value, o.label]));
const INVOICE_STATUS_LABEL_EN = Object.fromEntries(INVOICE_STATUS_OPTIONS_EN.map((o) => [o.value, o.label]));
const SEO_ISSUE_STATUS_LABEL_EN = Object.fromEntries(SEO_ISSUE_STATUS_OPTIONS_EN.map((o) => [o.value, o.label]));
const CLIENT_STAGE_LABEL_EN: Record<string, string> = {
  lead: "Lead",
  prospect: "Prospect",
  client: "Client",
  churned: "Churned",
};

export type AuditEntry = {
  action: string;
  targetType: string | null;
  targetId: string | null;
  metadata: unknown;
};

/** Category = the action's dotted prefix — used for the audit log filter and its labels. */
export const AUDIT_CATEGORY_LABEL: Record<string, string> = {
  crm: "CRM",
  user: "Utilisateurs",
  billing: "Facturation",
  gbp: "Google Business Profile",
  search_console: "Google Search Console",
  analytics: "Google Analytics",
  document: "Documents (portail)",
  organization: "Organisation",
  onboarding: "Accueil client",
  report: "Rapports",
  audit: "Audit IA",
};

export const AUDIT_CATEGORY_LABEL_EN: Record<string, string> = {
  crm: "CRM",
  user: "Users",
  billing: "Billing",
  gbp: "Google Business Profile",
  search_console: "Google Search Console",
  analytics: "Google Analytics",
  document: "Documents (portal)",
  organization: "Organization",
  onboarding: "Onboarding",
  report: "Reports",
  audit: "AI Audit",
};

export function getAuditCategoryLabel(locale: Locale): Record<string, string> {
  return locale === "en" ? AUDIT_CATEGORY_LABEL_EN : AUDIT_CATEGORY_LABEL;
}

export function categoryOf(action: string): string {
  return action.split(".")[0] ?? action;
}

/** metadata.clientId is stamped by lib/audit.ts::logCrmAudit() on every CRM action. */
export function clientIdOf(entry: AuditEntry): string | undefined {
  const m = (entry.metadata ?? {}) as Record<string, unknown>;
  return typeof m.clientId === "string" ? m.clientId : undefined;
}

function describeAuditEntryFr(entry: AuditEntry): string {
  const m = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case "audit.generated":
      return `Audit IA généré — score ${m.score}/100`;
    case "billing.canceled":
      return "Abonnement annulé";
    case "billing.subscribed":
      return `Abonnement souscrit : ${m.plan} (${m.priceEuros} €)`;
    case "crm.client_archived":
      return "Client archivé";
    case "crm.client_created":
      return `Client créé : ${m.name ?? ""}`;
    case "crm.client_deleted":
      return "Client supprimé";
    case "crm.client_stage_changed":
      return `Étape client changée : ${CLIENT_STAGE_LABEL[m.stage as string] ?? m.stage}`;
    case "crm.client_unarchived":
      return "Client désarchivé";
    case "crm.client_updated":
      return `Fiche client modifiée : ${m.name ?? ""}`;
    case "crm.quote_created":
      return `Devis créé : ${m.quoteNumber} — ${m.title}`;
    case "crm.quote_updated":
      return `Devis modifié : ${m.quoteNumber}`;
    case "crm.quote_status_changed":
      return `Devis ${m.quoteNumber} — statut : ${QUOTE_STATUS_LABEL[m.status as string] ?? m.status}`;
    case "crm.quote_deleted":
      return `Devis supprimé : ${m.quoteNumber}`;
    case "crm.invoice_created":
      return `Facture créée : ${m.invoiceNumber} — ${m.title}`;
    case "crm.invoice_created_from_quote":
      return `Facture ${m.invoiceNumber} créée à partir du devis ${m.quoteNumber}`;
    case "crm.invoice_updated":
      return `Facture modifiée : ${m.invoiceNumber}`;
    case "crm.invoice_status_changed":
      return `Facture ${m.invoiceNumber} — statut : ${INVOICE_STATUS_LABEL[m.status as string] ?? m.status}`;
    case "crm.invoice_deleted":
      return `Facture supprimée : ${m.invoiceNumber}`;
    case "crm.contract_created":
      return `Contrat créé : ${m.title}`;
    case "crm.contract_updated":
      return `Contrat modifié : ${m.title}`;
    case "crm.contract_sent":
      return "Contrat envoyé pour signature";
    case "crm.contract_signed":
      return "Contrat signé";
    case "crm.deal_created":
      return `Opportunité créée : ${m.title}`;
    case "crm.deal_deleted":
      return `Opportunité supprimée : ${m.title}`;
    case "crm.deal_stage_changed":
      return `Étape opportunité changée : ${DEAL_STAGE_LABEL[m.stage as string] ?? m.stage}`;
    case "crm.deal_updated":
      return `Opportunité modifiée : ${m.title}`;
    case "crm.demo_data_seeded":
      return "Données de démonstration générées";
    case "crm.document_deleted":
      return `Fichier CRM supprimé : ${m.fileName}`;
    case "crm.document_uploaded":
      return `Fichier CRM ajouté : ${m.fileName}`;
    case "crm.event_created":
      return `Événement créé : ${m.title}`;
    case "crm.event_updated":
      return `Événement modifié : ${m.title}`;
    case "crm.event_deleted":
      return `Événement supprimé : ${m.title}`;
    case "crm.interaction_logged":
      return m.summary ? `Interaction (${m.type}) : ${m.summary}` : `Interaction enregistrée (${m.type})`;
    case "crm.project_created":
      return `Projet créé : ${m.name}`;
    case "crm.project_updated":
      return `Projet modifié : ${m.name}`;
    case "crm.project_deleted":
      return `Projet supprimé : ${m.name}`;
    case "crm.project_status_changed":
      return `Statut projet changé : ${PROJECT_STATUS_LABEL[m.status as string] ?? m.status}`;
    case "crm.task_created":
      return `Tâche créée : ${m.title}`;
    case "crm.task_updated":
      return `Tâche modifiée : ${m.title}`;
    case "crm.task_deleted":
      return `Tâche supprimée : ${m.title}`;
    case "crm.task_status_changed":
      return `Statut tâche changé : ${TASK_STATUS_LABEL[m.status as string] ?? m.status}`;
    case "crm.ticket_created":
      return `Ticket ouvert : ${m.subject}`;
    case "crm.ticket_updated":
      return `Ticket modifié : ${m.subject}`;
    case "crm.ticket_deleted":
      return `Ticket supprimé : ${m.subject}`;
    case "crm.ticket_status_changed":
      return `Statut ticket changé : ${TICKET_STATUS_LABEL[m.status as string] ?? m.status}`;
    case "document.deleted":
      return "Document (portail) supprimé";
    case "document.uploaded":
      return `Document (portail) ajouté${entry.targetId ? ` : ${entry.targetId}` : ""}`;
    case "gbp.connected":
      return `Google Business Profile connecté (${m.locationCount ?? 0} établissement(s))`;
    case "gbp.synced":
      return `Synchronisation GBP (${m.locationCount ?? 0} établissement(s), ${m.newReviewCount ?? 0} nouvel avis)`;
    case "gbp.review_replied":
      return "Réponse à un avis Google publiée";
    case "gbp.connect_error":
      return `Erreur Google Business Profile : ${m.message ?? "erreur inconnue"}`;
    case "search_console.connected":
      return `Google Search Console connecté (${m.propertyCount ?? 0} propriété(s))`;
    case "search_console.synced":
      return `Synchronisation Search Console (${m.propertyCount ?? 0} propriété(s))`;
    case "search_console.connect_error":
      return `Erreur Google Search Console : ${m.message ?? "erreur inconnue"}`;
    case "analytics.connected":
      return `Google Analytics connecté (${m.propertyCount ?? 0} propriété(s))`;
    case "analytics.synced":
      return `Synchronisation Google Analytics (${m.propertyCount ?? 0} propriété(s))`;
    case "analytics.connect_error":
      return `Erreur Google Analytics : ${m.message ?? "erreur inconnue"}`;
    case "crm.client_linked_to_organization":
      return "Client rattaché à un espace plateforme (pour Google Business Profile)";
    case "crm.website_added":
      return `Site web ajouté : ${m.url ?? ""}`;
    case "crm.website_updated":
      return `Site web modifié : ${m.url ?? ""}`;
    case "crm.website_deleted":
      return `Site web supprimé : ${m.url ?? ""}`;
    case "crm.seo_audit_completed":
      return `Audit SEO terminé (${m.url ?? ""}) — score ${m.score}/100, ${m.issueCount ?? 0} recommandation(s)`;
    case "crm.seo_issue_status_changed":
      return `Recommandation SEO « ${m.title ?? ""} » — statut : ${SEO_ISSUE_STATUS_LABEL[m.status as string] ?? m.status}`;
    case "crm.seo_keyword_added":
      return `Mot-clé SEO ajouté au suivi : ${m.keyword ?? ""}`;
    case "crm.seo_keyword_deleted":
      return `Mot-clé SEO retiré du suivi : ${m.keyword ?? ""}`;
    case "crm.seo_keywords_refreshed":
      return `Positions des mots-clés actualisées (${m.keywordCount ?? 0} mot(s)-clé(s))`;
    case "onboarding.completed":
      return "Questionnaire d'accueil complété";
    case "organization.renamed":
      return `Organisation renommée : ${m.name}`;
    case "report.auto_generated":
      return "Rapport automatique généré";
    case "user.access_removed":
      return "Accès utilisateur retiré";
    case "user.invitation_revoked":
      return "Invitation annulée";
    case "user.invited":
      return `Utilisateur invité : ${m.email} (${m.role})`;
    case "user.role_changed":
      return `Rôle utilisateur modifié : ${m.newRole}`;
    default:
      return entry.action;
  }
}

function describeAuditEntryEn(entry: AuditEntry): string {
  const m = (entry.metadata ?? {}) as Record<string, unknown>;
  switch (entry.action) {
    case "audit.generated":
      return `AI audit generated — score ${m.score}/100`;
    case "billing.canceled":
      return "Subscription canceled";
    case "billing.subscribed":
      return `Subscribed to plan: ${m.plan} (€${m.priceEuros})`;
    case "crm.client_archived":
      return "Client archived";
    case "crm.client_created":
      return `Client created: ${m.name ?? ""}`;
    case "crm.client_deleted":
      return "Client deleted";
    case "crm.client_stage_changed":
      return `Client stage changed: ${CLIENT_STAGE_LABEL_EN[m.stage as string] ?? m.stage}`;
    case "crm.client_unarchived":
      return "Client unarchived";
    case "crm.client_updated":
      return `Client record updated: ${m.name ?? ""}`;
    case "crm.quote_created":
      return `Quote created: ${m.quoteNumber} — ${m.title}`;
    case "crm.quote_updated":
      return `Quote updated: ${m.quoteNumber}`;
    case "crm.quote_status_changed":
      return `Quote ${m.quoteNumber} — status: ${QUOTE_STATUS_LABEL_EN[m.status as string] ?? m.status}`;
    case "crm.quote_deleted":
      return `Quote deleted: ${m.quoteNumber}`;
    case "crm.invoice_created":
      return `Invoice created: ${m.invoiceNumber} — ${m.title}`;
    case "crm.invoice_created_from_quote":
      return `Invoice ${m.invoiceNumber} created from quote ${m.quoteNumber}`;
    case "crm.invoice_updated":
      return `Invoice updated: ${m.invoiceNumber}`;
    case "crm.invoice_status_changed":
      return `Invoice ${m.invoiceNumber} — status: ${INVOICE_STATUS_LABEL_EN[m.status as string] ?? m.status}`;
    case "crm.invoice_deleted":
      return `Invoice deleted: ${m.invoiceNumber}`;
    case "crm.contract_created":
      return `Contract created: ${m.title}`;
    case "crm.contract_updated":
      return `Contract updated: ${m.title}`;
    case "crm.contract_sent":
      return "Contract sent for signature";
    case "crm.contract_signed":
      return "Contract signed";
    case "crm.deal_created":
      return `Deal created: ${m.title}`;
    case "crm.deal_deleted":
      return `Deal deleted: ${m.title}`;
    case "crm.deal_stage_changed":
      return `Deal stage changed: ${DEAL_STAGE_LABEL_EN[m.stage as string] ?? m.stage}`;
    case "crm.deal_updated":
      return `Deal updated: ${m.title}`;
    case "crm.demo_data_seeded":
      return "Demo data seeded";
    case "crm.document_deleted":
      return `CRM file deleted: ${m.fileName}`;
    case "crm.document_uploaded":
      return `CRM file added: ${m.fileName}`;
    case "crm.event_created":
      return `Event created: ${m.title}`;
    case "crm.event_updated":
      return `Event updated: ${m.title}`;
    case "crm.event_deleted":
      return `Event deleted: ${m.title}`;
    case "crm.interaction_logged":
      return m.summary ? `Interaction (${m.type}): ${m.summary}` : `Interaction logged (${m.type})`;
    case "crm.project_created":
      return `Project created: ${m.name}`;
    case "crm.project_updated":
      return `Project updated: ${m.name}`;
    case "crm.project_deleted":
      return `Project deleted: ${m.name}`;
    case "crm.project_status_changed":
      return `Project status changed: ${PROJECT_STATUS_LABEL_EN[m.status as string] ?? m.status}`;
    case "crm.task_created":
      return `Task created: ${m.title}`;
    case "crm.task_updated":
      return `Task updated: ${m.title}`;
    case "crm.task_deleted":
      return `Task deleted: ${m.title}`;
    case "crm.task_status_changed":
      return `Task status changed: ${TASK_STATUS_LABEL_EN[m.status as string] ?? m.status}`;
    case "crm.ticket_created":
      return `Ticket opened: ${m.subject}`;
    case "crm.ticket_updated":
      return `Ticket updated: ${m.subject}`;
    case "crm.ticket_deleted":
      return `Ticket deleted: ${m.subject}`;
    case "crm.ticket_status_changed":
      return `Ticket status changed: ${TICKET_STATUS_LABEL_EN[m.status as string] ?? m.status}`;
    case "document.deleted":
      return "Document (portal) deleted";
    case "document.uploaded":
      return `Document (portal) added${entry.targetId ? `: ${entry.targetId}` : ""}`;
    case "gbp.connected":
      return `Google Business Profile connected (${m.locationCount ?? 0} location(s))`;
    case "gbp.synced":
      return `GBP sync (${m.locationCount ?? 0} location(s), ${m.newReviewCount ?? 0} new review)`;
    case "gbp.review_replied":
      return "Reply posted to a Google review";
    case "gbp.connect_error":
      return `Google Business Profile error: ${m.message ?? "unknown error"}`;
    case "search_console.connected":
      return `Google Search Console connected (${m.propertyCount ?? 0} propert(y/ies))`;
    case "search_console.synced":
      return `Search Console sync (${m.propertyCount ?? 0} propert(y/ies))`;
    case "search_console.connect_error":
      return `Google Search Console error: ${m.message ?? "unknown error"}`;
    case "analytics.connected":
      return `Google Analytics connected (${m.propertyCount ?? 0} propert(y/ies))`;
    case "analytics.synced":
      return `Google Analytics sync (${m.propertyCount ?? 0} propert(y/ies))`;
    case "analytics.connect_error":
      return `Google Analytics error: ${m.message ?? "unknown error"}`;
    case "crm.client_linked_to_organization":
      return "Client linked to a platform space (for Google Business Profile)";
    case "crm.website_added":
      return `Website added: ${m.url ?? ""}`;
    case "crm.website_updated":
      return `Website updated: ${m.url ?? ""}`;
    case "crm.website_deleted":
      return `Website deleted: ${m.url ?? ""}`;
    case "crm.seo_audit_completed":
      return `SEO audit completed (${m.url ?? ""}) — score ${m.score}/100, ${m.issueCount ?? 0} recommendation(s)`;
    case "crm.seo_issue_status_changed":
      return `SEO recommendation "${m.title ?? ""}" — status: ${SEO_ISSUE_STATUS_LABEL_EN[m.status as string] ?? m.status}`;
    case "crm.seo_keyword_added":
      return `SEO keyword added to tracking: ${m.keyword ?? ""}`;
    case "crm.seo_keyword_deleted":
      return `SEO keyword removed from tracking: ${m.keyword ?? ""}`;
    case "crm.seo_keywords_refreshed":
      return `Keyword rankings refreshed (${m.keywordCount ?? 0} keyword(s))`;
    case "onboarding.completed":
      return "Onboarding questionnaire completed";
    case "organization.renamed":
      return `Organization renamed: ${m.name}`;
    case "report.auto_generated":
      return "Automatic report generated";
    case "user.access_removed":
      return "User access removed";
    case "user.invitation_revoked":
      return "Invitation revoked";
    case "user.invited":
      return `User invited: ${m.email} (${m.role})`;
    case "user.role_changed":
      return `User role changed: ${m.newRole}`;
    default:
      return entry.action;
  }
}

/** Human-readable description of a logAudit() entry — shared between the
 * CRM client activity timeline and the global audit log page so the two
 * views never drift apart. `locale` translates the surrounding sentence
 * chrome only; interpolated values (client names, titles, amounts) are
 * always the stored business data, verbatim, in whatever language they
 * were originally entered. */
export function describeAuditEntry(entry: AuditEntry, locale: Locale = "fr"): string {
  return locale === "en" ? describeAuditEntryEn(entry) : describeAuditEntryFr(entry);
}
