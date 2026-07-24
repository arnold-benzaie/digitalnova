import {
  DEAL_STAGE_OPTIONS,
  PROJECT_STATUS_OPTIONS,
  TASK_STATUS_OPTIONS,
  TICKET_STATUS_OPTIONS,
} from "@/components/crm/badges";
import { INVOICE_STATUS_OPTIONS, QUOTE_STATUS_OPTIONS } from "@/lib/crm-billing";
import { SEO_ISSUE_STATUS_OPTIONS } from "@/lib/seo-shared";

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

export function categoryOf(action: string): string {
  return action.split(".")[0] ?? action;
}

/** metadata.clientId is stamped by lib/audit.ts::logCrmAudit() on every CRM action. */
export function clientIdOf(entry: AuditEntry): string | undefined {
  const m = (entry.metadata ?? {}) as Record<string, unknown>;
  return typeof m.clientId === "string" ? m.clientId : undefined;
}

/** Human-readable, French description of a logAudit() entry — shared between
 * the CRM client activity timeline and the global audit log page so the two
 * views never drift apart. */
export function describeAuditEntry(entry: AuditEntry): string {
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
