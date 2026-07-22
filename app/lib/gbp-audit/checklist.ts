import { GBP_AUDIT_SECTION_CODES } from "@/db/audit-schema";

export type GbpAuditSectionCode = (typeof GBP_AUDIT_SECTION_CODES)[number];

export type GbpAuditCheckDefinition = {
  key: string;
  label: string;
  /** What the agent should look at / where the evidence typically comes from. */
  guidance: string;
};

export type GbpAuditSectionDefinition = {
  code: GbpAuditSectionCode;
  letter: string; // A–S, matches the source checklist for cross-reference
  title: string;
};

/**
 * Static audit catalog (spec §8, sections A–S). Code, not DB-editable in
 * v1 — see db/schema.ts comment on gbpAuditFindings.checkKey. Each key must
 * be globally unique (used as the stable join key for findings across
 * audits, not scoped per-section) — sectionCode on the finding row
 * disambiguates for filtering/reporting.
 */
export const GBP_AUDIT_SECTIONS: GbpAuditSectionDefinition[] = [
  { code: "ownership", letter: "A", title: "Propriété et statut du profil" },
  { code: "business_name", letter: "B", title: "Nom de l'entreprise" },
  { code: "categories", letter: "C", title: "Catégorie principale et catégories secondaires" },
  { code: "address_service_area", letter: "D", title: "Adresse et zone desservie" },
  { code: "contact_info", letter: "E", title: "Coordonnées de contact" },
  { code: "hours", letter: "F", title: "Horaires" },
  { code: "description", letter: "G", title: "Description de l'entreprise" },
  { code: "services_products", letter: "H", title: "Services et produits" },
  { code: "photos_branding", letter: "I", title: "Photos, logo et identité visuelle" },
  { code: "reviews", letter: "J", title: "Avis clients" },
  { code: "questions_answers", letter: "K", title: "Questions et réponses" },
  { code: "posts", letter: "L", title: "Publications Google" },
  { code: "attributes", letter: "M", title: "Attributs" },
  { code: "links_features", letter: "N", title: "Liens et fonctionnalités" },
  { code: "website_consistency", letter: "O", title: "Site web et cohérence locale" },
  { code: "citations", letter: "P", title: "Citations et présence locale" },
  { code: "duplicates_conflicts", letter: "Q", title: "Doublons et conflits" },
  { code: "competition", letter: "R", title: "Concurrence locale" },
  { code: "suspension_risk", letter: "S", title: "Risques de suspension et conformité" },
];

export const GBP_AUDIT_CHECKS: Record<GbpAuditSectionCode, GbpAuditCheckDefinition[]> = {
  ownership: [
    { key: "profile_claimed", label: "Le profil est revendiqué", guidance: "Statut de propriété dans GBP" },
    { key: "primary_owner_identified", label: "Le propriétaire principal est identifié", guidance: "Utilisateurs du profil" },
    { key: "unknown_users_access", label: "Aucun utilisateur inconnu n'a accès", guidance: "Liste des gestionnaires" },
    { key: "verification_completed", label: "La vérification Google est terminée", guidance: "Statut de vérification" },
    { key: "not_suspended", label: "Le profil n'est pas suspendu", guidance: "Statut du profil" },
    { key: "not_disabled", label: "Le profil n'est pas désactivé", guidance: "Statut du profil" },
    { key: "no_pending_edits", label: "Aucune modification en attente bloquante", guidance: "Historique des modifications" },
    { key: "no_duplicate_profiles", label: "Aucun profil en double pour la même entreprise", guidance: "Recherche Google Maps" },
  ],
  business_name: [
    { key: "name_matches_real_business", label: "Le nom correspond au nom réel de l'entreprise", guidance: "Comparer au site/registre" },
    { key: "no_keyword_stuffing", label: "Aucun mot-clé artificiel ajouté au nom", guidance: "Fiche GBP" },
    { key: "no_unauthorized_city_service", label: "Ville/service non ajoutés au nom sans faire partie du nom officiel", guidance: "Fiche GBP" },
    { key: "name_consistent_with_website", label: "Nom cohérent avec le site web et les autres plateformes", guidance: "Site web, réseaux sociaux" },
    { key: "name_suspension_risk", label: "Le nom ne présente pas de risque de suspension", guidance: "Règles Google Business Profile" },
  ],
  categories: [
    { key: "primary_category_relevant", label: "Catégorie principale pertinente", guidance: "Fiche GBP" },
    { key: "secondary_categories_useful", label: "Catégories secondaires utiles présentes", guidance: "Fiche GBP" },
    { key: "no_incorrect_categories", label: "Aucune catégorie incorrecte", guidance: "Fiche GBP" },
    { key: "no_overly_generic_categories", label: "Aucune catégorie trop générale", guidance: "Fiche GBP" },
    { key: "missing_category_opportunities", label: "Opportunités de catégories manquantes identifiées", guidance: "Comparaison concurrence" },
  ],
  address_service_area: [
    { key: "address_accurate", label: "Adresse exacte", guidance: "Vérification terrain / Maps" },
    { key: "address_consistent_with_website", label: "Adresse cohérente avec le site web", guidance: "Page contact du site" },
    { key: "no_unauthorized_virtual_address", label: "Aucune adresse virtuelle ou non autorisée", guidance: "Règles Google" },
    { key: "service_area_correct", label: "Zone desservie correcte", guidance: "Fiche GBP" },
    { key: "no_duplicate_at_address", label: "Aucun doublon à la même adresse", guidance: "Recherche Google Maps" },
    { key: "map_pin_accurate", label: "Positionnement correct sur la carte", guidance: "Google Maps" },
    { key: "service_area_business_compliant", label: "Conformité pour les entreprises intervenant chez le client", guidance: "Règles Google (SAB)" },
  ],
  contact_info: [
    { key: "primary_phone_correct", label: "Numéro principal correct et fonctionnel", guidance: "Appel de test" },
    { key: "phone_numbers_consistent", label: "Cohérence des numéros (fiche, site, réseaux)", guidance: "Comparaison multi-sources" },
    { key: "website_url_correct", label: "Adresse du site web correcte, sans erreur de redirection", guidance: "Test du lien" },
    { key: "utm_parameters_used", label: "Paramètres UTM utilisés correctement", guidance: "URL du site sur la fiche" },
    { key: "location_specific_landing_page", label: "Lien vers une page adaptée à l'établissement", guidance: "Site web" },
  ],
  hours: [
    { key: "regular_hours_present", label: "Horaires habituels renseignés", guidance: "Fiche GBP" },
    { key: "special_hours_updated", label: "Horaires spéciaux / jours fériés à jour", guidance: "Fiche GBP" },
    { key: "hours_not_contradictory", label: "Aucune incohérence d'horaires", guidance: "Fiche GBP" },
    { key: "hours_consistent_with_website", label: "Cohérence avec le site web et les réseaux sociaux", guidance: "Comparaison multi-sources" },
  ],
  description: [
    { key: "description_present", label: "Description présente", guidance: "Fiche GBP" },
    { key: "description_clear", label: "Description claire et sans faute", guidance: "Fiche GBP" },
    { key: "no_promotional_content", label: "Aucune information promotionnelle interdite", guidance: "Règles Google" },
    { key: "no_misleading_claims", label: "Aucune affirmation trompeuse", guidance: "Fiche GBP" },
    { key: "description_matches_activity", label: "Cohérence avec l'activité réelle", guidance: "Fiche GBP vs. réalité" },
  ],
  services_products: [
    { key: "main_services_listed", label: "Principaux services présents", guidance: "Fiche GBP" },
    { key: "service_descriptions_quality", label: "Descriptions de qualité", guidance: "Fiche GBP" },
    { key: "no_obsolete_services", label: "Aucun service obsolète", guidance: "Fiche GBP" },
    { key: "product_images_present", label: "Images de produits/services présentes", guidance: "Fiche GBP" },
    { key: "strategic_services_missing", label: "Services stratégiques manquants identifiés", guidance: "Comparaison concurrence" },
  ],
  photos_branding: [
    { key: "logo_present", label: "Logo présent et à jour", guidance: "Fiche GBP" },
    { key: "cover_photo_quality", label: "Photo de couverture de bonne qualité", guidance: "Fiche GBP" },
    { key: "interior_exterior_photos", label: "Photos intérieures et extérieures présentes", guidance: "Fiche GBP" },
    { key: "no_blurry_outdated_photos", label: "Aucune photo floue ou obsolète", guidance: "Fiche GBP" },
    { key: "no_stock_photos", label: "Aucune image provenant d'une banque d'images", guidance: "Fiche GBP" },
    { key: "photo_upload_frequency", label: "Fréquence d'ajout de photos suffisante", guidance: "Historique des photos" },
  ],
  reviews: [
    { key: "review_count_volume", label: "Nombre total d'avis suffisant", guidance: "Fiche GBP" },
    { key: "average_rating", label: "Note moyenne", guidance: "Fiche GBP" },
    { key: "review_recency", label: "Récence des avis", guidance: "Fiche GBP" },
    { key: "response_rate", label: "Taux de réponse aux avis", guidance: "Fiche GBP" },
    { key: "response_quality", label: "Qualité des réponses (non génériques)", guidance: "Fiche GBP" },
    { key: "negative_reviews_untreated", label: "Avis négatifs non traités identifiés", guidance: "Fiche GBP" },
    { key: "review_authenticity_signals", label: "Signaux nécessitant une vérification humaine (jamais une affirmation automatique)", guidance: "Analyse manuelle" },
    { key: "review_request_link", label: "Lien direct de demande d'avis configuré", guidance: "Fiche GBP" },
  ],
  questions_answers: [
    { key: "unanswered_questions", label: "Questions sans réponse identifiées", guidance: "Fiche GBP" },
    { key: "incorrect_answers", label: "Réponses incorrectes identifiées", guidance: "Fiche GBP" },
    { key: "outdated_info_in_qa", label: "Informations obsolètes dans les réponses", guidance: "Fiche GBP" },
    { key: "anticipated_questions_missing", label: "Questions importantes pouvant être anticipées", guidance: "Analyse manuelle" },
  ],
  posts: [
    { key: "posts_present", label: "Publications présentes", guidance: "Fiche GBP" },
    { key: "posting_frequency", label: "Fréquence de publication", guidance: "Fiche GBP" },
    { key: "last_post_date", label: "Date de la dernière publication", guidance: "Fiche GBP" },
    { key: "no_expired_promotions", label: "Aucune promotion expirée affichée", guidance: "Fiche GBP" },
    { key: "editorial_calendar_exists", label: "Calendrier éditorial en place", guidance: "Processus agence" },
  ],
  attributes: [
    { key: "payment_methods_set", label: "Moyens de paiement renseignés", guidance: "Fiche GBP" },
    { key: "accessibility_set", label: "Accessibilité renseignée", guidance: "Fiche GBP" },
    { key: "delivery_pickup_set", label: "Options de livraison / retrait renseignées", guidance: "Fiche GBP" },
    { key: "sector_attributes_set", label: "Attributs propres au secteur renseignés", guidance: "Fiche GBP" },
  ],
  links_features: [
    { key: "booking_link_works", label: "Lien de réservation fonctionnel", guidance: "Test du lien" },
    { key: "order_link_works", label: "Lien de commande fonctionnel", guidance: "Test du lien" },
    { key: "menu_link_works", label: "Lien de menu fonctionnel (si pertinent)", guidance: "Test du lien" },
    { key: "whatsapp_link_relevant", label: "Lien WhatsApp présent si pertinent", guidance: "Fiche GBP" },
    { key: "no_broken_links", label: "Aucun lien cassé", guidance: "Test des liens" },
    { key: "links_secure_https", label: "Liens sécurisés (HTTPS)", guidance: "Test des liens" },
  ],
  website_consistency: [
    { key: "nap_consistency", label: "Cohérence nom / adresse / téléphone (NAP)", guidance: "Site web vs. fiche" },
    { key: "contact_page_present", label: "Page de contact présente", guidance: "Site web" },
    { key: "mobile_compatible", label: "Site compatible mobile", guidance: "Test responsive" },
    { key: "https_enabled", label: "HTTPS activé", guidance: "Test du site" },
    { key: "local_business_structured_data", label: "Données structurées LocalBusiness présentes", guidance: "Code source du site" },
    { key: "no_404_errors", label: "Aucune erreur 404 sur les pages clés", guidance: "Test des liens" },
  ],
  citations: [
    { key: "facebook_consistency", label: "Cohérence NAP sur Facebook", guidance: "Vérification manuelle" },
    { key: "instagram_consistency", label: "Cohérence NAP sur Instagram", guidance: "Vérification manuelle" },
    { key: "bing_places_consistency", label: "Cohérence NAP sur Bing Places", guidance: "Vérification manuelle" },
    { key: "apple_maps_consistency", label: "Cohérence NAP sur Apple Business Connect / Apple Maps", guidance: "Vérification manuelle" },
    { key: "local_directories_consistency", label: "Cohérence NAP sur les annuaires locaux pertinents", guidance: "Vérification manuelle" },
  ],
  duplicates_conflicts: [
    { key: "no_duplicate_profiles_conflict", label: "Aucun profil en double", guidance: "Recherche Google Maps" },
    { key: "no_old_closed_locations", label: "Aucune ancienne adresse / établissement fermé rattaché", guidance: "Google Maps" },
    { key: "no_third_party_created_profile", label: "Profil non créé par un tiers non autorisé", guidance: "Historique de propriété" },
    { key: "no_similar_name_competitor", label: "Aucune fiche concurrente au nom trompeusement proche", guidance: "Recherche Google Maps" },
  ],
  competition: [
    { key: "competitor_rating_compared", label: "Note moyenne comparée aux concurrents", guidance: "Voir module Concurrence" },
    { key: "competitor_review_count_compared", label: "Nombre d'avis comparé", guidance: "Voir module Concurrence" },
    { key: "competitor_response_rate_compared", label: "Taux de réponse comparé", guidance: "Voir module Concurrence" },
    { key: "competitor_content_compared", label: "Photos / publications comparées", guidance: "Voir module Concurrence" },
  ],
  suspension_risk: [
    { key: "risk_keyword_stuffed_name", label: "Nom surchargé de mots-clés", guidance: "Fiche GBP" },
    { key: "risk_fake_address", label: "Fausse adresse ou bureau virtuel non conforme", guidance: "Vérification terrain" },
    { key: "risk_misleading_categories", label: "Catégories trompeuses", guidance: "Fiche GBP" },
    { key: "risk_duplicate_listings", label: "Doublons de fiches", guidance: "Google Maps" },
    { key: "risk_inconsistent_phone", label: "Numéros incohérents entre les supports", guidance: "Comparaison multi-sources" },
    { key: "risk_frequent_contradictory_edits", label: "Modifications fréquentes et contradictoires", guidance: "Historique des modifications" },
    { key: "risk_brand_impersonation", label: "Usurpation de marque", guidance: "Recherche Google" },
    { key: "risk_insufficient_documents", label: "Documents insuffisants en cas de contrôle Google", guidance: "Dossier de vérification" },
  ],
};

export function getChecksForSection(code: GbpAuditSectionCode): GbpAuditCheckDefinition[] {
  return GBP_AUDIT_CHECKS[code] ?? [];
}

export const GBP_FINDING_RESULTS = [
  "compliant",
  "improvement_recommended",
  "major_issue",
  "critical_issue",
  "not_verifiable",
  "not_applicable",
] as const;

export const GBP_FINDING_RESULT_LABEL: Record<(typeof GBP_FINDING_RESULTS)[number], string> = {
  compliant: "Conforme",
  improvement_recommended: "Amélioration recommandée",
  major_issue: "Anomalie importante",
  critical_issue: "Anomalie critique",
  not_verifiable: "Non vérifiable",
  not_applicable: "Non applicable",
};

export const GBP_SEVERITIES = ["critical", "important", "moderate", "opportunity"] as const;

export const GBP_SEVERITY_LABEL: Record<(typeof GBP_SEVERITIES)[number], string> = {
  critical: "Critique",
  important: "Important",
  moderate: "Modéré",
  opportunity: "Opportunité",
};

export const GBP_AUDIT_STATUS_LABEL: Record<string, string> = {
  not_started: "À démarrer",
  in_progress: "En cours",
  pending_review: "En attente de validation",
  changes_requested: "Corrections demandées",
  approved: "Approuvé",
  sent: "Envoyé",
};

/**
 * Per-finding remediation lifecycle — distinct from gbpCorrectionTasks
 * (phase-grouped work items on the Plan de correction tab). This tracks
 * where a single detected issue stands, including states outside the
 * team's control (waiting_client, sent_to_google, waiting_google).
 */
export const GBP_CORRECTION_STATUSES = [
  "detected",
  "to_verify",
  "confirmed",
  "fix_proposed",
  "waiting_client",
  "in_progress",
  "fixed",
  "sent_to_google",
  "waiting_google",
  "resolved",
  "not_resolved",
  "not_applicable",
] as const;

export const GBP_CORRECTION_STATUS_LABEL: Record<(typeof GBP_CORRECTION_STATUSES)[number], string> = {
  detected: "Détecté",
  to_verify: "À vérifier",
  confirmed: "Confirmé",
  fix_proposed: "Correction proposée",
  waiting_client: "En attente du client",
  in_progress: "En cours",
  fixed: "Corrigé",
  sent_to_google: "Envoyé à Google",
  waiting_google: "En attente de Google",
  resolved: "Résolu",
  not_resolved: "Non résolu",
  not_applicable: "Non applicable",
};

export const GBP_PROFILE_STATUS_OPTIONS = [
  { value: "unknown", label: "Inconnu" },
  { value: "claimed", label: "Revendiqué" },
  { value: "unclaimed", label: "Non revendiqué" },
  { value: "suspended", label: "Suspendu" },
  { value: "disabled", label: "Désactivé" },
  { value: "duplicate", label: "Doublon" },
];

/**
 * Score = 100 minus a weighted penalty per finding, critical findings
 * weighing far more than opportunities — matches spec §9 ("les points
 * critiques doivent avoir un poids plus important"). Deliberately simple
 * and auditable rather than a black-box formula: PUBLIC-MAP staff must be
 * able to explain any score to a prospect. These are the defaults; an
 * admin can override them from Paramètres → Scoring (see
 * lib/gbp-audit/settings.ts) — callers that have a live settings row
 * should pass its weights in rather than relying on this default.
 */
export const DEFAULT_SEVERITY_PENALTY: Record<string, number> = {
  critical: 14,
  important: 7,
  moderate: 3,
  opportunity: 1,
};

export function computeAuditScore(
  findings: { result: string; severity: string | null }[],
  severityPenalty: Record<string, number> = DEFAULT_SEVERITY_PENALTY,
): number {
  let score = 100;
  for (const finding of findings) {
    if (finding.result === "compliant" || finding.result === "not_applicable" || finding.result === "not_verifiable") {
      continue;
    }
    score -= severityPenalty[finding.severity ?? "moderate"] ?? severityPenalty.moderate;
  }
  return Math.max(0, Math.min(100, score));
}

export function scoreBand(score: number): { label: string; description: string } {
  if (score >= 90) return { label: "Excellent", description: "Profil très bien optimisé." };
  if (score >= 75) return { label: "Satisfaisant", description: "Profil satisfaisant avec améliorations possibles." };
  if (score >= 50) return { label: "Faiblesses importantes", description: "Plusieurs faiblesses importantes à corriger." };
  if (score >= 25) return { label: "Fortement incomplet", description: "Profil fortement incomplet ou mal configuré." };
  return { label: "Critique", description: "Situation critique nécessitant une intervention prioritaire." };
}

/** Which of spec §9's 8 sub-scores each of the 19 categories feeds into. */
export const SECTION_SUBSCORE: Record<GbpAuditSectionCode, keyof typeof SUBSCORE_LABEL> = {
  ownership: "suspensionRisk",
  business_name: "compliance",
  categories: "compliance",
  address_service_area: "compliance",
  contact_info: "compliance",
  hours: "compliance",
  description: "completeness",
  services_products: "completeness",
  photos_branding: "completeness",
  attributes: "completeness",
  reviews: "reputation",
  questions_answers: "reputation",
  posts: "content",
  links_features: "userExperience",
  website_consistency: "localConsistency",
  citations: "localConsistency",
  duplicates_conflicts: "suspensionRisk",
  competition: "visibility",
  suspension_risk: "suspensionRisk",
};

export const SUBSCORE_LABEL = {
  compliance: "Conformité du profil",
  completeness: "Complétude",
  reputation: "Réputation",
  content: "Contenu",
  localConsistency: "Cohérence locale",
  visibility: "Visibilité",
  suspensionRisk: "Risque de suspension",
  userExperience: "Expérience utilisateur",
} as const;

export type SubscoreKey = keyof typeof SUBSCORE_LABEL;

export type ScoreableFinding = { sectionCode: string; result: string; severity: string | null };

/** Full score breakdown (overall + 8 sub-scores) from a flat list of findings — the single source of truth called after every finding save. */
export function computeFullAuditScore(
  findings: ScoreableFinding[],
  severityPenalty: Record<string, number> = DEFAULT_SEVERITY_PENALTY,
): { overall: number } & Record<SubscoreKey, number> {
  const bySubscore: Record<SubscoreKey, ScoreableFinding[]> = {
    compliance: [], completeness: [], reputation: [], content: [],
    localConsistency: [], visibility: [], suspensionRisk: [], userExperience: [],
  };
  for (const finding of findings) {
    const key = SECTION_SUBSCORE[finding.sectionCode as GbpAuditSectionCode];
    if (key) bySubscore[key].push(finding);
  }
  const result = { overall: computeAuditScore(findings, severityPenalty) } as { overall: number } & Record<SubscoreKey, number>;
  for (const key of Object.keys(SUBSCORE_LABEL) as SubscoreKey[]) {
    // A sub-score with zero checks yet stays at 100 (nothing wrong found because nothing's been checked) —
    // it's the overall score, weighted toward what HAS been checked, that reflects incompleteness.
    result[key] = bySubscore[key].length > 0 ? computeAuditScore(bySubscore[key], severityPenalty) : 100;
  }
  return result;
}
