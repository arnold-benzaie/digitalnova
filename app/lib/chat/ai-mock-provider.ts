import type { AiProvider, AiProviderInput, AiProviderOutput, AiSuggestion } from "@/lib/chat/ai-provider";

/**
 * Phase 1A mock provider for the AI Assistant WIDGET — deliberately
 * separate from the pre-existing, unrelated `lib/ai/mock-provider.ts`
 * (GBP audit-score/onboarding-summary generation, `MockAIProvider`
 * class, `AIProvider`/`AuditInput`/`AuditResult` types). That module
 * already existed before this feature and is used by
 * lib/actions/audit.ts and lib/actions/onboarding.ts — namespacing this
 * file under lib/chat/ instead of reusing lib/ai/ avoids ever colliding
 * with it, per "ne casse aucun composant existant."
 *
 * No external call, no cost, no API key. Simple keyword classification
 * over the user's latest message, FR/EN, covering the scenarios the
 * approved plan asked to validate end-to-end (Google Ads help, GBP help,
 * SEO, website, automation, account help, performance, "how it works",
 * human escalation, lead capture, and an "I don't know" fallback that
 * never invents a price/promotion/certification/guarantee — see §3/§24).
 * Deliberately rule-based and inspectable rather than templated-random,
 * so Playwright/unit tests can assert an exact reply for a given input.
 *
 * The conversational REPLY text is business/AI-generated content (same
 * category as a notification's `rawBody` override, see
 * lib/notifications.ts) — it is intentionally hardcoded FR/EN here
 * rather than routed through lib/i18n/dictionaries, exactly like the
 * fixed example sentences in the approved plan's §24. Suggestion CHIPS
 * are the opposite: pure UI copy, so this file returns only stable ids
 * (see lib/chat/ai-provider.ts's AiSuggestion) — their FR/EN label text
 * lives in lib/i18n/dictionaries/chat.ts, resolved by the widget UI.
 *
 * A single sentinel phrase (TEST_SIMULATE_PROVIDER_ERROR, exact match,
 * case-insensitive) throws on purpose — used only by tests to exercise
 * the API route's error handling and the widget's retry UI (§24 "erreur
 * simulée contrôlée"). Not documented to end users; harmless if a real
 * user ever typed it verbatim (worst case: one generic retryable error).
 *
 * Phase 1C (public-map.com UX enrichment): adds a much larger catalog of
 * `surface:"site"`-only sub-topic branches ("leaves") below — one per
 * suggestion card in the widget's richer "Suggestions rapides" panel and
 * per follow-up sub-menu (GBP / Google Ads / SEO / website / automation /
 * lead generation). Every leaf is gated behind `isSite(input)` and
 * checked BEFORE the original Phase 1A/1B branches, so:
 *   - an app-surface (dashboard) request, or any request with no
 *     `surface` at all (every existing test, every in-app dashboard
 *     widget call — see chat-panel.tsx, which never sends `surface`),
 *     never reaches this new code at all — byte-identical old behavior.
 *   - a site request whose message happens to also contain an OLDER,
 *     broader keyword (e.g. "Automatiser mes leads" contains
 *     "automatiser") still resolves to the more specific new leaf
 *     first, because leaves are checked first — not the older, broader
 *     "automation" branch.
 * The six original topic branches (gbp / google_ads / seo / website /
 * automation / performance) are also enriched: for `surface:"site"` they
 * return a topic-specific sub-menu (and, for website/automation/
 * performance, a richer reply) instead of the flat 6-chip set; for every
 * other surface their reply text and suggestions are untouched.
 */

const ERROR_SIMULATION_TRIGGER = "test_simulate_provider_error";

function matchesAny(message: string, needles: string[]): boolean {
  return needles.some((needle) => message.includes(needle));
}

function ids(...values: string[]): AiSuggestion[] {
  return values.map((id) => ({ id }));
}

function isSite(input: AiProviderInput): boolean {
  return input.surface === "site";
}

const DEFAULT_SUGGESTIONS: AiSuggestion[] = [{ id: "google_ads" }, { id: "how_it_works" }, { id: "performance" }, { id: "account_help" }, { id: "human" }];

/**
 * Phase 1B: public-map.com visitors are anonymous prospects, not signed-in
 * dashboard users — "how_it_works"/"performance"/"account_help" all
 * presuppose an existing PUBLIC-MAP account, which reads oddly to someone
 * who hasn't signed up yet (see the Phase 1B report's architecture-audit
 * notes). Swaps in prospect-facing chips instead: discovering/optimizing
 * services and getting a quote, keeping "google_ads" and "human" since
 * both already read naturally pre-signup.
 *
 * Phase 1C: this is also the widget's "Suggestions rapides" main-6 set —
 * see chat-widget-embed.js's INITIAL_SUGGESTIONS_MAIN, which must list
 * the exact same 6 ids in the same order.
 */
const SITE_SUGGESTIONS: AiSuggestion[] = ids("gbp", "google_ads", "seo", "website", "automation", "quote");

function suggestionsFor(input: AiProviderInput): AiSuggestion[] {
  return isSite(input) ? SITE_SUGGESTIONS : DEFAULT_SUGGESTIONS;
}

// ---- Phase 1C: public-map.com sub-flow catalog -----------------------
// Every array below is a closed, hand-picked set of ids — never
// generated/free-form — so a leaf always resolves to a real, tested
// branch. "quote" and "human" (§7/§8 of the request) are reused as-is
// everywhere: both already have dedicated branches below (unchanged)
// that show the existing lead form / human-escalation path, so a
// conversation started from any sub-menu always converges on the same
// real capture mechanism rather than a dead end.
const GBP_SUB_SUGGESTIONS = ids("gbp_audit", "gbp_info", "seo_local", "gbp_reviews", "gbp_posts", "gbp_photos", "gbp_performance");
const ADS_SUB_SUGGESTIONS = ids("ads_new_campaign", "ads_audit", "ads_search", "ads_pmax", "ads_display", "ads_conversion_tracking", "ads_reports");
const SEO_SUB_SUGGESTIONS = ids("seo_local", "seo_technical", "seo_keywords", "seo_pages", "seo_search_console", "seo_audit");
const WEBSITE_SUB_SUGGESTIONS = ids("website_showcase", "website_booking", "website_ecommerce", "website_landing", "website_custom", "quote");
const AUTOMATION_SUB_SUGGESTIONS = ids(
  "automation_leads",
  "automation_support",
  "automation_emails",
  "automation_whatsapp",
  "automation_crm",
  "automation_examples",
  "quote",
  "human",
);
const LEAD_GENERATION_SUB_SUGGESTIONS = ids("google_ads", "seo", "website_landing", "leadgen_forms", "automation_leads", "automation_crm", "leadgen_qualification");
const PERFORMANCE_REVIEW_SUGGESTIONS = ids("gbp", "google_ads", "seo", "quote");
const REVIEWS_SUGGESTIONS = ids("gbp_reviews", "quote", "human");
const CLOSING_SUGGESTIONS = ids("quote", "human");

type SiteLeaf = {
  needles: string[];
  fr: string;
  en: string;
  suggestions?: AiSuggestion[]; // defaults to CLOSING_SUGGESTIONS (quote + human)
};

/**
 * Short, specific sub-topic replies — one per suggestion card that isn't
 * itself a top-level topic. Checked top-to-bottom, first match wins;
 * `ads_search` (needle "search") is deliberately last because it's the
 * shortest/most generic needle in the whole table and would otherwise
 * shadow more specific entries whose text happens to contain "search"
 * (e.g. English "Keyword research" contains "search").
 */
const SITE_LEAVES: SiteLeaf[] = [
  // --- Google Business Profile sub-menu ---------------------------------
  { needles: ["audit du profil", "profile audit"], fr: "Un audit complet de votre fiche Google Business Profile identifie ce qui freine votre visibilité locale (informations manquantes, catégorie, avis, photos, activité). Souhaitez-vous qu'un conseiller PUBLIC-MAP réalise cet audit pour vous ?", en: "A full Google Business Profile audit identifies what's holding back your local visibility (missing info, category, reviews, photos, activity). Would you like a PUBLIC-MAP advisor to run this audit for you?" },
  { needles: ["optimisation des informations", "business info optimization"], fr: "PUBLIC-MAP peut optimiser les informations de votre fiche (catégorie, horaires, description, services) pour améliorer votre référencement local. Voulez-vous un devis pour cette optimisation ?", en: "PUBLIC-MAP can optimize your listing's information (category, hours, description, services) to improve your local search ranking. Would you like a quote for this?" },
  { needles: ["gestion des avis", "reviews management"], fr: "PUBLIC-MAP peut vous aider à obtenir plus d'avis clients et à y répondre efficacement pour renforcer votre réputation en ligne.", en: "PUBLIC-MAP can help you get more customer reviews and respond to them effectively to strengthen your online reputation." },
  { needles: ["publications"], fr: "Publier régulièrement sur votre profil Google Business Profile (offres, actualités, événements) améliore votre visibilité. PUBLIC-MAP peut gérer ces publications pour vous.", en: "Posting regularly on your Google Business Profile (offers, news, events) improves your visibility. PUBLIC-MAP can manage these posts for you." },
  { needles: ["photos"], fr: "Des photos de qualité et à jour augmentent la confiance et les clics vers votre établissement. PUBLIC-MAP peut vous accompagner sur ce point.", en: "Fresh, high-quality photos increase trust and clicks toward your business. PUBLIC-MAP can help with that." },
  { needles: ["suivi des performances", "performance tracking"], fr: "PUBLIC-MAP centralise le suivi de vos performances Google Business Profile : vues, recherches, appels et itinéraires.", en: "PUBLIC-MAP centralizes your Google Business Profile performance tracking: views, searches, calls, and direction requests." },

  // --- Google Ads sub-menu -----------------------------------------------
  { needles: ["créer une campagne", "create a campaign"], fr: "PUBLIC-MAP peut créer votre campagne Google Ads de A à Z, alignée sur votre objectif : prospects, appels, ventes ou visibilité.", en: "PUBLIC-MAP can build your Google Ads campaign end-to-end, aligned with your goal: leads, calls, sales, or visibility." },
  { needles: ["auditer une campagne", "audit an existing campaign"], fr: "PUBLIC-MAP peut auditer vos campagnes Google Ads existantes pour identifier les points d'amélioration et réduire votre coût par prospect.", en: "PUBLIC-MAP can audit your existing Google Ads campaigns to find improvements and lower your cost per lead." },
  { needles: ["performance max"], fr: "Performance Max diffuse vos annonces sur tous les canaux Google (Search, Display, YouTube, Maps) à partir d'un seul objectif. PUBLIC-MAP peut configurer cela pour vous.", en: "Performance Max runs your ads across every Google channel (Search, Display, YouTube, Maps) from a single goal. PUBLIC-MAP can set this up for you." },
  { needles: ["display"], fr: "Les campagnes Display renforcent votre notoriété grâce à des visuels diffusés sur le réseau de sites partenaires de Google.", en: "Display campaigns build awareness with visuals shown across Google's partner site network." },
  { needles: ["suivi des conversions", "conversion tracking"], fr: "PUBLIC-MAP peut mettre en place un suivi précis de vos conversions (appels, formulaires, ventes) pour mesurer le vrai retour sur investissement de vos campagnes.", en: "PUBLIC-MAP can set up accurate conversion tracking (calls, forms, sales) to measure the real return on your campaigns." },
  { needles: ["rapports", "reports"], fr: "PUBLIC-MAP fournit des rapports clairs sur la performance de vos campagnes Google Ads, directement accessibles depuis votre tableau de bord.", en: "PUBLIC-MAP provides clear reports on your Google Ads performance, directly available from your dashboard." },

  // --- SEO sub-menu --------------------------------------------------------
  { needles: ["seo technique", "technical seo"], fr: "L'audit technique SEO vérifie la vitesse, l'indexation et la structure de votre site pour lever les freins au référencement.", en: "A technical SEO audit checks your site's speed, indexing, and structure to remove what's holding back your ranking." },
  { needles: ["mots-clés", "keyword research"], fr: "PUBLIC-MAP identifie les mots-clés les plus pertinents pour attirer vos clients potentiels.", en: "PUBLIC-MAP identifies the most relevant keywords to attract your potential customers." },
  { needles: ["optimisation des pages", "page optimization"], fr: "PUBLIC-MAP optimise le contenu et la structure de vos pages pour mieux vous positionner sur Google.", en: "PUBLIC-MAP optimizes your pages' content and structure to help you rank better on Google." },
  { needles: ["search console"], fr: "PUBLIC-MAP peut connecter et suivre votre Google Search Console pour surveiller votre visibilité et corriger les erreurs d'indexation.", en: "PUBLIC-MAP can connect and monitor your Google Search Console to track visibility and fix indexing errors." },
  { needles: ["audit seo", "seo audit"], fr: "Un audit SEO complet identifie précisément ce qui limite votre référencement aujourd'hui, avec un plan d'action priorisé.", en: "A full SEO audit pinpoints exactly what's limiting your ranking today, with a prioritized action plan." },
  { needles: ["seo local", "local seo"], fr: "Le SEO local aide votre établissement à apparaître dans les recherches de proximité et sur Google Maps. PUBLIC-MAP peut auditer et améliorer votre positionnement local.", en: "Local SEO helps your business show up in nearby searches and on Google Maps. PUBLIC-MAP can audit and improve your local ranking." },

  // --- Website sub-menu ------------------------------------------------
  { needles: ["site vitrine", "showcase website"], fr: "Un site vitrine présente clairement votre entreprise, vos services et vos coordonnées pour convertir vos visiteurs en clients.", en: "A showcase website clearly presents your business, services, and contact details to turn visitors into customers." },
  { needles: ["réservation", "booking website"], fr: "PUBLIC-MAP peut intégrer un système de réservation en ligne directement sur votre site.", en: "PUBLIC-MAP can add an online booking system directly to your website." },
  { needles: ["e-commerce"], fr: "PUBLIC-MAP peut créer votre boutique en ligne, du catalogue produits au paiement sécurisé.", en: "PUBLIC-MAP can build your online store, from product catalog to secure checkout." },
  { needles: ["landing page"], fr: "Une landing page dédiée à une offre précise améliore vos taux de conversion pour vos campagnes publicitaires.", en: "A landing page dedicated to a specific offer improves your conversion rate for advertising campaigns." },
  { needles: ["plateforme personnalisée", "custom platform"], fr: "Pour un besoin spécifique, PUBLIC-MAP peut concevoir une plateforme sur mesure adaptée à votre activité.", en: "For a specific need, PUBLIC-MAP can design a custom platform tailored to your business." },

  // --- Automation sub-menu ----------------------------------------------
  { needles: ["automatiser mes leads", "automate my leads"], fr: "PUBLIC-MAP peut qualifier et distribuer automatiquement vos nouveaux prospects dès leur arrivée.", en: "PUBLIC-MAP can automatically qualify and route your new leads as soon as they come in." },
  { needles: ["automatiser mon support", "automate my customer support"], fr: "PUBLIC-MAP peut mettre en place des réponses automatiques pour traiter vos demandes clients les plus fréquentes.", en: "PUBLIC-MAP can set up automated replies to handle your most frequent customer requests." },
  { needles: ["automatiser mes emails", "automate my emails"], fr: "PUBLIC-MAP peut automatiser vos emails de relance et de suivi client.", en: "PUBLIC-MAP can automate your follow-up and customer-tracking emails." },
  { needles: ["automatiser whatsapp", "automate whatsapp"], fr: "PUBLIC-MAP peut automatiser vos réponses et notifications WhatsApp.", en: "PUBLIC-MAP can automate your WhatsApp replies and notifications." },
  { needles: ["automatiser mon crm", "automate my crm"], fr: "PUBLIC-MAP peut connecter et automatiser votre CRM pour ne plus jamais perdre le suivi d'un client.", en: "PUBLIC-MAP can connect and automate your CRM so you never lose track of a customer again." },
  { needles: ["voir des exemples", "see examples"], fr: "Quelques exemples concrets : qualification automatique d'un prospect entrant, relance automatique après un rendez-vous manqué, réponse automatique en dehors des heures d'ouverture, synchronisation CRM et formulaires via webhook.", en: "A few concrete examples: automatic qualification of an incoming lead, automatic follow-up after a missed appointment, automatic replies outside business hours, and CRM-to-forms syncing via webhook." },

  // --- Lead generation sub-menu (new leaves only — Google Ads/SEO/landing
  // page/lead automation/CRM reuse the branches above) --------------------
  { needles: ["formulaires", "forms"], fr: "PUBLIC-MAP peut créer des formulaires intelligents qui captent et qualifient automatiquement vos prospects.", en: "PUBLIC-MAP can build smart forms that automatically capture and qualify your leads." },
  { needles: ["qualification automatique", "automatic qualification"], fr: "PUBLIC-MAP peut qualifier automatiquement vos prospects selon vos propres critères, pour que votre équipe se concentre sur les plus prometteurs.", en: "PUBLIC-MAP can automatically qualify your leads against your own criteria, so your team focuses on the most promising ones." },

  // --- Top-level "Voir plus" topics without their own numbered sous-parcours
  { needles: ["avis clients", "customer reviews"], fr: "PUBLIC-MAP peut vous aider à obtenir plus d'avis clients et à améliorer votre note moyenne sur Google — un levier clé de confiance et de visibilité locale.", en: "PUBLIC-MAP can help you get more customer reviews and improve your average Google rating — a key trust and local-visibility driver.", suggestions: REVIEWS_SUGGESTIONS },
  { needles: ["générer plus de prospects", "generate more leads"], fr: "PUBLIC-MAP peut vous aider à générer plus de prospects grâce à Google Ads, au SEO, à des landing pages optimisées, des formulaires intelligents et une automatisation complète de vos leads. Par où souhaitez-vous commencer ?", en: "PUBLIC-MAP can help you generate more leads through Google Ads, SEO, optimized landing pages, smart forms, and full lead automation. Where would you like to start?", suggestions: LEAD_GENERATION_SUB_SUGGESTIONS },

  // Kept last — the shortest/most generic needle in this table (see the
  // comment above SITE_LEAVES).
  { needles: ["search"], fr: "Les campagnes Search ciblent les recherches actives de vos clients potentiels sur Google. PUBLIC-MAP peut mettre cela en place pour vous.", en: "Search campaigns target your potential customers' active searches on Google. PUBLIC-MAP can set this up for you." },
];

function unknownFallback(locale: "fr" | "en"): string {
  return locale === "en"
    ? "I'd rather not give you uncertain information. I can forward your request to a PUBLIC-MAP advisor."
    : "Je préfère ne pas vous donner une information incertaine. Je peux transmettre votre demande à un conseiller PUBLIC-MAP.";
}

async function generateReply(input: AiProviderInput): Promise<AiProviderOutput> {
  const locale = input.locale;
  const message = input.userMessage.trim().toLowerCase();

  if (message === ERROR_SIMULATION_TRIGGER) {
    throw new Error("mock-provider: simulated error (test sentinel)");
  }

  if (isSite(input)) {
    for (const leaf of SITE_LEAVES) {
      if (matchesAny(message, leaf.needles)) {
        return { reply: locale === "en" ? leaf.en : leaf.fr, suggestions: leaf.suggestions ?? CLOSING_SUGGESTIONS };
      }
    }
  }

  if (matchesAny(message, ["parler à", "conseiller", "talk to", "advisor", "human", "quelqu'un", "someone"])) {
    return {
      reply:
        locale === "en"
          ? "Sure. I can forward your request to a PUBLIC-MAP advisor. Could you leave me your contact details?"
          : "Bien sûr. Je peux transmettre votre demande à un conseiller PUBLIC-MAP. Pouvez-vous me laisser vos coordonnées ?",
      action: { type: "show_lead_form" },
    };
  }

  if (matchesAny(message, ["contacter", "être contacté", "contact me", "devis", "quote", "rappeler", "call me back"])) {
    return {
      reply:
        locale === "en"
          ? "Of course — I can have a PUBLIC-MAP advisor reach out to you. Could you leave me your contact details?"
          : "Bien sûr — je peux faire en sorte qu'un conseiller PUBLIC-MAP vous contacte. Pouvez-vous me laisser vos coordonnées ?",
      action: { type: "show_lead_form" },
    };
  }

  if (matchesAny(message, ["google business profile", "gbp", "fiche établissement", "fiche google", "business profile"])) {
    return {
      reply:
        locale === "en"
          ? "Sure. PUBLIC-MAP can help you optimize your Google Business Profile. Would you like to improve your local visibility, your business information, your customer reviews, or your overall performance?"
          : "Bien sûr. PUBLIC-MAP peut vous accompagner dans l'optimisation de votre profil Google Business. Souhaitez-vous améliorer votre visibilité locale, vos informations, vos avis clients ou vos performances générales ?",
      suggestions: isSite(input) ? GBP_SUB_SUGGESTIONS : suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["google ads", "campagne", "campaign", "publicité", "ads", "adwords"])) {
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP can help you set up and monitor Google Ads campaigns. To start, what's your main goal: getting leads, generating calls, selling online, or increasing visibility?"
          : "PUBLIC-MAP peut vous accompagner dans la création et le suivi de campagnes Google Ads. Pour commencer, quel est votre principal objectif : obtenir des prospects, générer des appels, vendre en ligne ou augmenter votre visibilité ?",
      suggestions: isSite(input) ? ADS_SUB_SUGGESTIONS : suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["seo", "référencement", "search console", "classement", "ranking"])) {
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP can help improve your local and national SEO, and track your Google Search Console performance. Would you like to focus on local search, national search, or technical SEO?"
          : "PUBLIC-MAP peut vous aider à améliorer votre référencement local et national, et suivre vos performances Google Search Console. Souhaitez-vous vous concentrer sur le référencement local, national ou technique ?",
      suggestions: isSite(input) ? SEO_SUB_SUGGESTIONS : suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["site web", "website", "landing page", "créer mon site", "improve my website", "build a website"])) {
    return {
      reply: isSite(input)
        ? locale === "en"
          ? "PUBLIC-MAP can build or redesign your site: a showcase website, a booking website, an e-commerce store, a landing page, or a custom platform. New site or redesign? Which type best fits your needs?"
          : "PUBLIC-MAP peut créer ou refaire votre site : vitrine, avec réservation en ligne, e-commerce, landing page ou plateforme personnalisée. Nouveau site ou refonte ? Quel type de projet correspond le mieux à votre besoin ?"
        : locale === "en"
          ? "PUBLIC-MAP can help you create or improve your website and landing pages. Do you already have a website, or are you starting from scratch?"
          : "PUBLIC-MAP peut vous accompagner pour créer ou améliorer votre site web et vos landing pages. Avez-vous déjà un site, ou partez-vous de zéro ?",
      suggestions: isSite(input) ? WEBSITE_SUB_SUGGESTIONS : suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["automatiser", "automation", "automate", "intégration", "n8n", "webhook", "automatisation", "business automation"])) {
    return {
      reply: isSite(input)
        ? locale === "en"
          ? "PUBLIC-MAP can automate many parts of your business using AI, for example:\n• Automatic handling of customer requests\n• Automatic lead qualification\n• Automated replies (website, WhatsApp, email)\n• CRM workflows and automated follow-ups\n• Smart forms\n• Automatic report generation\n• Syncing your tools together (n8n, webhooks, API)\n• Automating admin tasks\n\nWhat would you like to automate first?"
          : "PUBLIC-MAP peut automatiser de nombreuses tâches de votre entreprise grâce à l'IA, par exemple :\n• Traitement automatique des demandes clients\n• Qualification automatique des prospects\n• Réponses automatiques (site, WhatsApp, email)\n• Workflows CRM et relances automatiques\n• Formulaires intelligents\n• Génération automatique de rapports\n• Synchronisation de vos outils (n8n, webhooks, API)\n• Automatisation de tâches administratives\n\nQu'aimeriez-vous automatiser en premier ?"
        : locale === "en"
          ? "PUBLIC-MAP can help automate parts of your business and connect your tools together. What would you like to automate first?"
          : "PUBLIC-MAP peut vous aider à automatiser certaines tâches de votre entreprise et à connecter vos outils. Qu'aimeriez-vous automatiser en premier ?",
      suggestions: isSite(input) ? AUTOMATION_SUB_SUGGESTIONS : suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["performance", "résultats", "results", "statistiques", "stats", "analytics"])) {
    return {
      reply: isSite(input)
        ? locale === "en"
          ? "PUBLIC-MAP can analyze your digital performance: local visibility (Google Business Profile), SEO, advertising campaigns (Google Ads), and your website traffic. Which area would you like an assessment of first?"
          : "PUBLIC-MAP peut analyser vos performances digitales : visibilité locale (Google Business Profile), référencement (SEO), campagnes publicitaires (Google Ads) et trafic de votre site. Sur quel point souhaitez-vous un état des lieux ?"
        : locale === "en"
          ? "You can track your performance directly from your PUBLIC-MAP dashboard — Google Business Profile, Search Console, Analytics, and Google Ads all have their own section. Would you like help finding one of them?"
          : "Vous pouvez suivre vos performances directement depuis votre tableau de bord PUBLIC-MAP — Google Business Profile, Search Console, Analytics et Google Ads ont chacun leur propre section. Voulez-vous de l'aide pour retrouver l'une d'elles ?",
      suggestions: isSite(input) ? PERFORMANCE_REVIEW_SUGGESTIONS : suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["comment fonctionne", "how does", "fonctionnement", "how it works"])) {
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP centralizes your Google Business Profile, Search Console, Analytics, and Google Ads in one dashboard, with audits and recommendations to help you grow. What would you like to know more about?"
          : "PUBLIC-MAP centralise votre Google Business Profile, Search Console, Analytics et Google Ads dans un seul tableau de bord, avec des audits et des recommandations pour vous aider à progresser. Que souhaitez-vous en savoir plus ?",
      suggestions: suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["compte", "account", "connecter mon compte", "connect my account", "mot de passe", "password", "aide avec mon compte"])) {
    return {
      reply:
        locale === "en"
          ? "I can help with your account. Is this about connecting a Google integration, your organization settings, or something else?"
          : "Je peux vous aider avec votre compte. S'agit-il de connecter une intégration Google, des paramètres de votre organisation, ou autre chose ?",
      suggestions: suggestionsFor(input),
    };
  }

  return { reply: unknownFallback(locale), action: { type: "show_lead_form" }, suggestions: suggestionsFor(input) };
}

export const mockAiProvider: AiProvider = { generateReply };
