import { GBP_AUDIT_SECTION_CODES } from "@/db/audit-schema";
import type { Locale } from "@/lib/i18n/dictionaries";

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

const SCORE_BANDS_EN: { min: number; label: string; description: string }[] = [
  { min: 90, label: "Excellent", description: "Very well optimized profile." },
  { min: 75, label: "Satisfactory", description: "Satisfactory profile with room for improvement." },
  { min: 50, label: "Significant weaknesses", description: "Several significant weaknesses to fix." },
  { min: 25, label: "Largely incomplete", description: "Largely incomplete or poorly configured profile." },
  { min: -Infinity, label: "Critical", description: "Critical situation requiring priority action." },
];

/** `locale` defaults to "fr" so existing callers (PDF report generation,
 * still French-only pending the Reports/PDF phase) keep working unchanged. */
export function scoreBand(score: number, locale: Locale = "fr"): { label: string; description: string } {
  if (locale === "en") {
    const band = SCORE_BANDS_EN.find((b) => score >= b.min)!;
    return { label: band.label, description: band.description };
  }
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

/**
 * English mirror of the section/check catalog above, plus locale-aware
 * accessors (getAuditSections/getAuditChecksBySection/getFindingResultLabel/
 * getSeverityLabel/getAuditStatusLabel/getCorrectionStatusLabel/
 * getProfileStatusOptions/getSubscoreLabel).
 *
 * The plain exports above (GBP_AUDIT_SECTIONS, GBP_AUDIT_CHECKS,
 * GBP_FINDING_RESULT_LABEL, GBP_SEVERITY_LABEL, GBP_AUDIT_STATUS_LABEL,
 * GBP_CORRECTION_STATUS_LABEL, GBP_PROFILE_STATUS_OPTIONS, SUBSCORE_LABEL)
 * stay untouched and always French — they're still used as-is by
 * lib/gbp-audit/report-data.ts (PDF report generation) and by
 * lib/actions/gbp-audit*.ts (enum validation against GBP_FINDING_RESULTS/
 * GBP_SEVERITIES/GBP_CORRECTION_STATUSES, which are stable keys, not
 * display text), both out of scope for this phase (PDF/reports is a later
 * phase). Every UI surface translated in this phase calls the locale-aware
 * functions below instead.
 */
export const GBP_AUDIT_SECTIONS_EN: GbpAuditSectionDefinition[] = [
  { code: "ownership", letter: "A", title: "Ownership and profile status" },
  { code: "business_name", letter: "B", title: "Business name" },
  { code: "categories", letter: "C", title: "Primary and secondary categories" },
  { code: "address_service_area", letter: "D", title: "Address and service area" },
  { code: "contact_info", letter: "E", title: "Contact information" },
  { code: "hours", letter: "F", title: "Hours" },
  { code: "description", letter: "G", title: "Business description" },
  { code: "services_products", letter: "H", title: "Services and products" },
  { code: "photos_branding", letter: "I", title: "Photos, logo, and branding" },
  { code: "reviews", letter: "J", title: "Customer reviews" },
  { code: "questions_answers", letter: "K", title: "Questions and answers" },
  { code: "posts", letter: "L", title: "Google posts" },
  { code: "attributes", letter: "M", title: "Attributes" },
  { code: "links_features", letter: "N", title: "Links and features" },
  { code: "website_consistency", letter: "O", title: "Website and local consistency" },
  { code: "citations", letter: "P", title: "Citations and local presence" },
  { code: "duplicates_conflicts", letter: "Q", title: "Duplicates and conflicts" },
  { code: "competition", letter: "R", title: "Local competition" },
  { code: "suspension_risk", letter: "S", title: "Suspension risk and compliance" },
];

export const GBP_AUDIT_CHECKS_EN: Record<GbpAuditSectionCode, GbpAuditCheckDefinition[]> = {
  ownership: [
    { key: "profile_claimed", label: "The profile is claimed", guidance: "Ownership status in GBP" },
    { key: "primary_owner_identified", label: "The primary owner is identified", guidance: "Profile users" },
    { key: "unknown_users_access", label: "No unknown user has access", guidance: "List of managers" },
    { key: "verification_completed", label: "Google verification is complete", guidance: "Verification status" },
    { key: "not_suspended", label: "The profile is not suspended", guidance: "Profile status" },
    { key: "not_disabled", label: "The profile is not disabled", guidance: "Profile status" },
    { key: "no_pending_edits", label: "No blocking pending edits", guidance: "Edit history" },
    { key: "no_duplicate_profiles", label: "No duplicate profile for the same business", guidance: "Google Maps search" },
  ],
  business_name: [
    { key: "name_matches_real_business", label: "The name matches the business's real name", guidance: "Compare against website/registry" },
    { key: "no_keyword_stuffing", label: "No artificial keywords added to the name", guidance: "GBP listing" },
    { key: "no_unauthorized_city_service", label: "No city/service added to the name unless part of the official name", guidance: "GBP listing" },
    { key: "name_consistent_with_website", label: "Name consistent with the website and other platforms", guidance: "Website, social media" },
    { key: "name_suspension_risk", label: "The name does not present a suspension risk", guidance: "Google Business Profile rules" },
  ],
  categories: [
    { key: "primary_category_relevant", label: "Relevant primary category", guidance: "GBP listing" },
    { key: "secondary_categories_useful", label: "Useful secondary categories present", guidance: "GBP listing" },
    { key: "no_incorrect_categories", label: "No incorrect category", guidance: "GBP listing" },
    { key: "no_overly_generic_categories", label: "No overly generic category", guidance: "GBP listing" },
    { key: "missing_category_opportunities", label: "Missing category opportunities identified", guidance: "Competitor comparison" },
  ],
  address_service_area: [
    { key: "address_accurate", label: "Accurate address", guidance: "Field check / Maps" },
    { key: "address_consistent_with_website", label: "Address consistent with the website", guidance: "Website contact page" },
    { key: "no_unauthorized_virtual_address", label: "No virtual or unauthorized address", guidance: "Google rules" },
    { key: "service_area_correct", label: "Correct service area", guidance: "GBP listing" },
    { key: "no_duplicate_at_address", label: "No duplicate at the same address", guidance: "Google Maps search" },
    { key: "map_pin_accurate", label: "Accurate map pin placement", guidance: "Google Maps" },
    { key: "service_area_business_compliant", label: "Compliant for service-area businesses", guidance: "Google rules (SAB)" },
  ],
  contact_info: [
    { key: "primary_phone_correct", label: "Primary number correct and working", guidance: "Test call" },
    { key: "phone_numbers_consistent", label: "Consistent numbers (listing, website, social media)", guidance: "Multi-source comparison" },
    { key: "website_url_correct", label: "Correct website address, no redirect error", guidance: "Link test" },
    { key: "utm_parameters_used", label: "UTM parameters used correctly", guidance: "Website URL on the listing" },
    { key: "location_specific_landing_page", label: "Link to a page matching the location", guidance: "Website" },
  ],
  hours: [
    { key: "regular_hours_present", label: "Regular hours filled in", guidance: "GBP listing" },
    { key: "special_hours_updated", label: "Special hours / holidays up to date", guidance: "GBP listing" },
    { key: "hours_not_contradictory", label: "No inconsistent hours", guidance: "GBP listing" },
    { key: "hours_consistent_with_website", label: "Consistent with the website and social media", guidance: "Multi-source comparison" },
  ],
  description: [
    { key: "description_present", label: "Description present", guidance: "GBP listing" },
    { key: "description_clear", label: "Clear, error-free description", guidance: "GBP listing" },
    { key: "no_promotional_content", label: "No prohibited promotional content", guidance: "Google rules" },
    { key: "no_misleading_claims", label: "No misleading claims", guidance: "GBP listing" },
    { key: "description_matches_activity", label: "Consistent with the actual activity", guidance: "GBP listing vs. reality" },
  ],
  services_products: [
    { key: "main_services_listed", label: "Main services present", guidance: "GBP listing" },
    { key: "service_descriptions_quality", label: "Quality descriptions", guidance: "GBP listing" },
    { key: "no_obsolete_services", label: "No obsolete service", guidance: "GBP listing" },
    { key: "product_images_present", label: "Product/service images present", guidance: "GBP listing" },
    { key: "strategic_services_missing", label: "Missing strategic services identified", guidance: "Competitor comparison" },
  ],
  photos_branding: [
    { key: "logo_present", label: "Logo present and up to date", guidance: "GBP listing" },
    { key: "cover_photo_quality", label: "Good-quality cover photo", guidance: "GBP listing" },
    { key: "interior_exterior_photos", label: "Interior and exterior photos present", guidance: "GBP listing" },
    { key: "no_blurry_outdated_photos", label: "No blurry or outdated photo", guidance: "GBP listing" },
    { key: "no_stock_photos", label: "No stock photo library image", guidance: "GBP listing" },
    { key: "photo_upload_frequency", label: "Sufficient photo upload frequency", guidance: "Photo history" },
  ],
  reviews: [
    { key: "review_count_volume", label: "Sufficient total review count", guidance: "GBP listing" },
    { key: "average_rating", label: "Average rating", guidance: "GBP listing" },
    { key: "review_recency", label: "Review recency", guidance: "GBP listing" },
    { key: "response_rate", label: "Review response rate", guidance: "GBP listing" },
    { key: "response_quality", label: "Response quality (not generic)", guidance: "GBP listing" },
    { key: "negative_reviews_untreated", label: "Untreated negative reviews identified", guidance: "GBP listing" },
    { key: "review_authenticity_signals", label: "Signals requiring human review (never an automatic claim)", guidance: "Manual analysis" },
    { key: "review_request_link", label: "Direct review request link configured", guidance: "GBP listing" },
  ],
  questions_answers: [
    { key: "unanswered_questions", label: "Unanswered questions identified", guidance: "GBP listing" },
    { key: "incorrect_answers", label: "Incorrect answers identified", guidance: "GBP listing" },
    { key: "outdated_info_in_qa", label: "Outdated information in answers", guidance: "GBP listing" },
    { key: "anticipated_questions_missing", label: "Important questions that could be anticipated", guidance: "Manual analysis" },
  ],
  posts: [
    { key: "posts_present", label: "Posts present", guidance: "GBP listing" },
    { key: "posting_frequency", label: "Posting frequency", guidance: "GBP listing" },
    { key: "last_post_date", label: "Date of the last post", guidance: "GBP listing" },
    { key: "no_expired_promotions", label: "No expired promotion displayed", guidance: "GBP listing" },
    { key: "editorial_calendar_exists", label: "Editorial calendar in place", guidance: "Agency process" },
  ],
  attributes: [
    { key: "payment_methods_set", label: "Payment methods filled in", guidance: "GBP listing" },
    { key: "accessibility_set", label: "Accessibility filled in", guidance: "GBP listing" },
    { key: "delivery_pickup_set", label: "Delivery / pickup options filled in", guidance: "GBP listing" },
    { key: "sector_attributes_set", label: "Sector-specific attributes filled in", guidance: "GBP listing" },
  ],
  links_features: [
    { key: "booking_link_works", label: "Booking link works", guidance: "Link test" },
    { key: "order_link_works", label: "Order link works", guidance: "Link test" },
    { key: "menu_link_works", label: "Menu link works (if relevant)", guidance: "Link test" },
    { key: "whatsapp_link_relevant", label: "WhatsApp link present if relevant", guidance: "GBP listing" },
    { key: "no_broken_links", label: "No broken link", guidance: "Link test" },
    { key: "links_secure_https", label: "Secure links (HTTPS)", guidance: "Link test" },
  ],
  website_consistency: [
    { key: "nap_consistency", label: "Name / address / phone (NAP) consistency", guidance: "Website vs. listing" },
    { key: "contact_page_present", label: "Contact page present", guidance: "Website" },
    { key: "mobile_compatible", label: "Mobile-compatible website", guidance: "Responsive test" },
    { key: "https_enabled", label: "HTTPS enabled", guidance: "Website test" },
    { key: "local_business_structured_data", label: "LocalBusiness structured data present", guidance: "Website source code" },
    { key: "no_404_errors", label: "No 404 error on key pages", guidance: "Link test" },
  ],
  citations: [
    { key: "facebook_consistency", label: "NAP consistency on Facebook", guidance: "Manual check" },
    { key: "instagram_consistency", label: "NAP consistency on Instagram", guidance: "Manual check" },
    { key: "bing_places_consistency", label: "NAP consistency on Bing Places", guidance: "Manual check" },
    { key: "apple_maps_consistency", label: "NAP consistency on Apple Business Connect / Apple Maps", guidance: "Manual check" },
    { key: "local_directories_consistency", label: "NAP consistency on relevant local directories", guidance: "Manual check" },
  ],
  duplicates_conflicts: [
    { key: "no_duplicate_profiles_conflict", label: "No duplicate profile", guidance: "Google Maps search" },
    { key: "no_old_closed_locations", label: "No old / closed location attached", guidance: "Google Maps" },
    { key: "no_third_party_created_profile", label: "Profile not created by an unauthorized third party", guidance: "Ownership history" },
    { key: "no_similar_name_competitor", label: "No competitor listing with a deceptively similar name", guidance: "Google Maps search" },
  ],
  competition: [
    { key: "competitor_rating_compared", label: "Average rating compared against competitors", guidance: "See the Competition tab" },
    { key: "competitor_review_count_compared", label: "Review count compared", guidance: "See the Competition tab" },
    { key: "competitor_response_rate_compared", label: "Response rate compared", guidance: "See the Competition tab" },
    { key: "competitor_content_compared", label: "Photos / posts compared", guidance: "See the Competition tab" },
  ],
  suspension_risk: [
    { key: "risk_keyword_stuffed_name", label: "Keyword-stuffed name", guidance: "GBP listing" },
    { key: "risk_fake_address", label: "Fake address or non-compliant virtual office", guidance: "Field check" },
    { key: "risk_misleading_categories", label: "Misleading categories", guidance: "GBP listing" },
    { key: "risk_duplicate_listings", label: "Duplicate listings", guidance: "Google Maps" },
    { key: "risk_inconsistent_phone", label: "Inconsistent numbers across sources", guidance: "Multi-source comparison" },
    { key: "risk_frequent_contradictory_edits", label: "Frequent, contradictory edits", guidance: "Edit history" },
    { key: "risk_brand_impersonation", label: "Brand impersonation", guidance: "Google search" },
    { key: "risk_insufficient_documents", label: "Insufficient documents in case of a Google review", guidance: "Verification file" },
  ],
};

export const GBP_FINDING_RESULT_LABEL_EN: Record<(typeof GBP_FINDING_RESULTS)[number], string> = {
  compliant: "Compliant",
  improvement_recommended: "Improvement recommended",
  major_issue: "Major issue",
  critical_issue: "Critical issue",
  not_verifiable: "Not verifiable",
  not_applicable: "Not applicable",
};

export const GBP_SEVERITY_LABEL_EN: Record<(typeof GBP_SEVERITIES)[number], string> = {
  critical: "Critical",
  important: "Important",
  moderate: "Moderate",
  opportunity: "Opportunity",
};

export const GBP_AUDIT_STATUS_LABEL_EN: Record<string, string> = {
  not_started: "Not started",
  in_progress: "In progress",
  pending_review: "Pending review",
  changes_requested: "Changes requested",
  approved: "Approved",
  sent: "Sent",
};

export const GBP_CORRECTION_STATUS_LABEL_EN: Record<(typeof GBP_CORRECTION_STATUSES)[number], string> = {
  detected: "Detected",
  to_verify: "To verify",
  confirmed: "Confirmed",
  fix_proposed: "Fix proposed",
  waiting_client: "Waiting on client",
  in_progress: "In progress",
  fixed: "Fixed",
  sent_to_google: "Sent to Google",
  waiting_google: "Waiting on Google",
  resolved: "Resolved",
  not_resolved: "Not resolved",
  not_applicable: "Not applicable",
};

export const GBP_PROFILE_STATUS_OPTIONS_EN: { value: string; label: string }[] = [
  { value: "unknown", label: "Unknown" },
  { value: "claimed", label: "Claimed" },
  { value: "unclaimed", label: "Unclaimed" },
  { value: "suspended", label: "Suspended" },
  { value: "disabled", label: "Disabled" },
  { value: "duplicate", label: "Duplicate" },
];

export const SUBSCORE_LABEL_EN: Record<SubscoreKey, string> = {
  compliance: "Profile compliance",
  completeness: "Completeness",
  reputation: "Reputation",
  content: "Content",
  localConsistency: "Local consistency",
  visibility: "Visibility",
  suspensionRisk: "Suspension risk",
  userExperience: "User experience",
};

export function getAuditSections(locale: Locale): GbpAuditSectionDefinition[] {
  return locale === "en" ? GBP_AUDIT_SECTIONS_EN : GBP_AUDIT_SECTIONS;
}

export function getAuditChecksBySection(locale: Locale): Record<GbpAuditSectionCode, GbpAuditCheckDefinition[]> {
  return locale === "en" ? GBP_AUDIT_CHECKS_EN : GBP_AUDIT_CHECKS;
}

export function getFindingResultLabel(locale: Locale): Record<(typeof GBP_FINDING_RESULTS)[number], string> {
  return locale === "en" ? GBP_FINDING_RESULT_LABEL_EN : GBP_FINDING_RESULT_LABEL;
}

export function getSeverityLabel(locale: Locale): Record<(typeof GBP_SEVERITIES)[number], string> {
  return locale === "en" ? GBP_SEVERITY_LABEL_EN : GBP_SEVERITY_LABEL;
}

export function getAuditStatusLabel(locale: Locale): Record<string, string> {
  return locale === "en" ? GBP_AUDIT_STATUS_LABEL_EN : GBP_AUDIT_STATUS_LABEL;
}

export function getCorrectionStatusLabel(locale: Locale): Record<(typeof GBP_CORRECTION_STATUSES)[number], string> {
  return locale === "en" ? GBP_CORRECTION_STATUS_LABEL_EN : GBP_CORRECTION_STATUS_LABEL;
}

export function getProfileStatusOptions(locale: Locale): { value: string; label: string }[] {
  return locale === "en" ? GBP_PROFILE_STATUS_OPTIONS_EN : GBP_PROFILE_STATUS_OPTIONS;
}

export function getSubscoreLabel(locale: Locale): Record<SubscoreKey, string> {
  return locale === "en" ? SUBSCORE_LABEL_EN : SUBSCORE_LABEL;
}
