import type { Locale } from "@/lib/i18n/dictionaries";

/**
 * Single source of truth for turning `auditActivityLog.action` and audit
 * webhook event names into display labels — shared by the dashboard's recent
 * activity feed, the per-audit timeline, and the webhooks admin page so
 * they can't drift apart the way two separately-maintained copies did.
 * Never render `.action` or a webhook `.event` string directly; always go
 * through getActivityActionLabel()/getWebhookEventLabel().
 */
export const ACTIVITY_ACTION_LABEL: Record<string, string> = {
  prospect_created: "Prospect créé",
  audit_created: "Audit créé",
  status_changed: "Statut de l'audit modifié",
  finding_saved: "Contrôle mis à jour",
  finding_correction_status_changed: "Statut de correction modifié",
  evidence_added: "Preuve ajoutée",
  evidence_deleted: "Preuve supprimée",
  correction_task_created: "Tâche de correction créée",
  correction_task_updated: "Tâche de correction modifiée",
  correction_task_status_changed: "Tâche de correction mise à jour",
  competitor_added: "Concurrent ajouté",
  competitor_updated: "Concurrent modifié",
  business_profile_stats_updated: "Statistiques de notre profil mises à jour",
  business_profile_status_changed: "Statut du profil modifié",
  comment_added: "Commentaire ajouté",
  comment_deleted: "Commentaire supprimé",
  quote_request_created: "Demande de devis reçue",
  quote_request_status_changed: "Demande de devis mise à jour",
  service_offer_created: "Offre de service créée",
  service_offer_updated: "Offre de service modifiée",
  service_offer_toggled: "Offre de service activée/désactivée",
  service_offer_deleted: "Offre de service supprimée",
  staff_invited: "Membre invité",
  staff_role_changed: "Rôle d'un membre modifié",
  staff_access_removed: "Accès d'un membre retiré",
  staff_invitation_revoked: "Invitation annulée",
  audit_submitted: "Audit soumis pour validation",
  audit_approved: "Audit approuvé",
  audit_changes_requested: "Corrections demandées",
  report_access_link_created: "Lien sécurisé généré",
  report_access_link_revoked: "Lien sécurisé révoqué",
  audit_sent: "Rapport envoyé",
  settings_general_updated: "Paramètres généraux modifiés",
  settings_scoring_updated: "Paramètres de scoring modifiés",
  settings_pdf_updated: "Paramètres des rapports PDF modifiés",
  settings_notifications_updated: "Paramètres de notifications modifiés",
  settings_webhooks_updated: "Paramètres webhooks modifiés",
  settings_security_updated: "Paramètres de sécurité modifiés",
};

export const WEBHOOK_EVENT_LABEL: Record<string, string> = {
  "gbp_audit.prospect_created": "Prospect créé",
  "gbp_audit.audit_created": "Audit créé",
  "gbp_audit.status_changed": "Statut de l'audit modifié",
  "gbp_audit.profile_status_changed": "Statut du profil modifié",
  "gbp_audit.finding_status_changed": "Statut de correction d'un contrôle modifié",
  "gbp_audit.correction_task_status_changed": "Tâche de correction mise à jour",
  "gbp_audit.audit_submitted": "Audit soumis pour validation",
  "gbp_audit.audit_approved": "Audit approuvé",
  "gbp_audit.report_sent": "Rapport envoyé",
  "gbp_audit.quote_requested": "Demande de devis reçue",
};

export const ACTIVITY_ACTION_LABEL_EN: Record<string, string> = {
  prospect_created: "Prospect created",
  audit_created: "Audit created",
  status_changed: "Audit status changed",
  finding_saved: "Check updated",
  finding_correction_status_changed: "Correction status changed",
  evidence_added: "Evidence added",
  evidence_deleted: "Evidence deleted",
  correction_task_created: "Correction task created",
  correction_task_updated: "Correction task updated",
  correction_task_status_changed: "Correction task updated",
  competitor_added: "Competitor added",
  competitor_updated: "Competitor updated",
  business_profile_stats_updated: "Our profile stats updated",
  business_profile_status_changed: "Profile status changed",
  comment_added: "Comment added",
  comment_deleted: "Comment deleted",
  quote_request_created: "Quote request received",
  quote_request_status_changed: "Quote request updated",
  service_offer_created: "Service offer created",
  service_offer_updated: "Service offer updated",
  service_offer_toggled: "Service offer enabled/disabled",
  service_offer_deleted: "Service offer deleted",
  staff_invited: "Member invited",
  staff_role_changed: "Member role changed",
  staff_access_removed: "Member access removed",
  staff_invitation_revoked: "Invitation revoked",
  audit_submitted: "Audit submitted for approval",
  audit_approved: "Audit approved",
  audit_changes_requested: "Changes requested",
  report_access_link_created: "Secure link generated",
  report_access_link_revoked: "Secure link revoked",
  audit_sent: "Report sent",
  settings_general_updated: "General settings updated",
  settings_scoring_updated: "Scoring settings updated",
  settings_pdf_updated: "PDF report settings updated",
  settings_notifications_updated: "Notification settings updated",
  settings_webhooks_updated: "Webhook settings updated",
  settings_security_updated: "Security settings updated",
};

export const WEBHOOK_EVENT_LABEL_EN: Record<string, string> = {
  "gbp_audit.prospect_created": "Prospect created",
  "gbp_audit.audit_created": "Audit created",
  "gbp_audit.status_changed": "Audit status changed",
  "gbp_audit.profile_status_changed": "Profile status changed",
  "gbp_audit.finding_status_changed": "A check's correction status changed",
  "gbp_audit.correction_task_status_changed": "Correction task updated",
  "gbp_audit.audit_submitted": "Audit submitted for approval",
  "gbp_audit.audit_approved": "Audit approved",
  "gbp_audit.report_sent": "Report sent",
  "gbp_audit.quote_requested": "Quote request received",
};

export function getActivityActionLabel(locale: Locale): Record<string, string> {
  return locale === "en" ? ACTIVITY_ACTION_LABEL_EN : ACTIVITY_ACTION_LABEL;
}

export function getWebhookEventLabel(locale: Locale): Record<string, string> {
  return locale === "en" ? WEBHOOK_EVENT_LABEL_EN : WEBHOOK_EVENT_LABEL;
}
