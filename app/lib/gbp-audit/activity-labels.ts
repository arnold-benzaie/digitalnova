/**
 * Single source of truth for turning `auditActivityLog.action` and audit
 * webhook event names into French labels — shared by the dashboard's recent
 * activity feed, the per-audit timeline, and the webhooks admin page so
 * they can't drift apart the way two separately-maintained copies did.
 * Never render `.action` or a webhook `.event` string directly; always go
 * through these maps.
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
