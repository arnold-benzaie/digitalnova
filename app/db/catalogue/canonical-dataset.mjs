// PUBLIC-MAP — P0.1B.2 canonical catalogue dataset (PREVIEW schema only).
//
// Every value here was either read verbatim from the public site
// (index.html, dyn-price-card / srv-card / g-pair-card attributes and
// text) or is an explicit human decision made during the P0.1A/P0.1B
// Product Director conversation. Nothing here is invented. Where a
// field could not be sourced or decided, it is `null` with a comment —
// never filled with a guess or a translation I made up myself.
//
// descriptionFr uses the Canada-side copy as the canonical single value
// (services/service_market_offers keeps description at the *service*
// level, not per-market — most CA/EU descriptions are near-identical,
// differing only by a market-specific clause such as GDPR wording).
//
// descriptionEnStatus: "SOURCE_VERIFIED" = read verbatim from a
// data-*-desc-en attribute in index.html. "HUMAN_APPROVED" = the site
// never had an English description for this item; the text was
// supplied and explicitly approved by the human owner (P0.1B.2 dataset
// finalization turn) after a contradiction check against the validated
// French scope found no material conflict. This field is metadata for
// this dataset file only — it is not a column in the approved schema
// and is never sent to the database by the seed script.

export const SERVICES = [
  // ---- PACKS (6) ----
  {
    serviceId: "pack_gbp_seo_launch",
    type: "PACK",
    category: "google_business_profile",
    priceDerivation: "INDEPENDENT",
    displayNameFr: "Pack Lancement Local IA",
    displayNameEn: "Local Launch Pack",
    descriptionFr: "Pour transformer une fiche Google gratuite en présence locale claire, crédible et prête à recevoir des demandes",
    descriptionEn: "Build a stronger local presence with essential Google Business Profile optimization, review collection tools, local visibility recommendations and practical next steps for your business.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "pack_local_growth",
    type: "PACK",
    category: "google_business_profile",
    priceDerivation: "INDEPENDENT",
    displayNameFr: "Pack Croissance Locale IA",
    displayNameEn: "Local Growth Pack",
    descriptionFr: "Pour les PME qui veulent rester actives sur Google, rassurer les clients et suivre les actions utiles chaque mois",
    descriptionEn: "Strengthen your local visibility with ongoing Google Business Profile activity, content support, review management resources, AI visibility optimization and prioritized monthly actions.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "pack_all_inclusive_prestige",
    type: "PACK",
    category: "all_inclusive",
    priceDerivation: "INDEPENDENT",
    displayNameFr: "Pack Tout-Inclus Prestige IA",
    displayNameEn: "All-Inclusive Prestige Pack",
    descriptionFr: "La solution complète pour renforcer durablement votre visibilité au Canada avec SEO national, avis assistés par IA, publications Google, réseaux sociaux Meta et assistance premium.",
    descriptionEn: "The complete solution to sustainably strengthen your visibility in Canada with national SEO, AI-assisted reviews, Google posts, Meta social networks and premium support.",
  },
  {
    serviceId: "pack_website_automation",
    type: "PACK",
    category: "website",
    priceDerivation: "INDEPENDENT",
    displayNameFr: "Site + Automatisation IA",
    displayNameEn: "Website & Automation Pack",
    descriptionFr: "Pour obtenir une base digitale sérieuse prête pour les demandes, le suivi et une future intégration de paiement autorisée",
    descriptionEn: "Build a conversion-focused website or landing page with lead capture, lightweight CRM workflows, follow-up automation, analytics and launch reporting.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "pack_international_seo",
    type: "PACK",
    category: "seo",
    priceDerivation: "INDEPENDENT",
    displayNameFr: "Référencement international — Canada & Europe",
    displayNameEn: "International SEO — Canada & Europe",
    descriptionFr: "Pour préparer votre marque à Google, Google Maps et aux recherches assistées par IA dans plusieurs pays",
    descriptionEn: "Develop your search visibility across Canada, Europe, the UK and selected French-speaking markets with international SEO strategy, market-specific keyword research, GEO optimization and prioritized content opportunities.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "ads_campaigns_management",
    type: "PACK",
    category: "advertising",
    priceDerivation: "INDEPENDENT",
    displayNameFr: "Campagnes Google Ads & Meta Ads",
    displayNameEn: "Google Ads & Meta Ads Campaign Management",
    descriptionFr: "Pour attirer des prospects plus vite avec des campagnes propres, mesurées et reliées à vos formulaires de demande",
    descriptionEn: "Structure and manage Google Ads or Meta Ads campaigns with conversion-focused pages or forms, lead tracking, ongoing optimization and clear performance reporting.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },

  // ---- INDIVIDUAL SERVICES (20) ----
  {
    serviceId: "ai_visibility",
    type: "INDIVIDUAL_SERVICE",
    category: "ai_visibility",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Visibilité IA — AEO / GEO",
    displayNameEn: "AI Visibility — AEO / GEO",
    descriptionFr: "Optimisation pour être trouvé et cité par les moteurs de réponse IA — ChatGPT, Perplexity et Google AI Overviews. Contenu structuré, entités claires et balisage technique pour maximiser vos chances d'apparaître dans les réponses générées par l'IA.",
    descriptionEn: "Optimization to be found and cited by AI answer engines — ChatGPT, Perplexity and Google AI Overviews. Structured content, clear entities and technical markup to maximize your chances of appearing in AI-generated answers.",
  },
  {
    serviceId: "gbp_owner_access_training",
    type: "INDIVIDUAL_SERVICE",
    category: "google_business_profile",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Intervention GMB",
    displayNameEn: "GMB Session",
    descriptionFr: "Accès propriétaire, configuration de base et formation personnalisée pour gérer votre fiche Google Business Profile avec plus d'autonomie.",
    descriptionEn: "Owner access, basic setup and personalized training to manage your Google Business Profile with more autonomy.",
  },
  {
    serviceId: "maps_security", // technical ID kept as-is per approved decision — never renamed
    type: "INDIVIDUAL_SERVICE",
    category: "google_business_profile",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Sécurisation & configuration Google Business Profile",
    displayNameEn: "Google Business Profile Security & Setup",
    descriptionFr: "PUBLIC-MAP vérifie, sécurise et optimise votre fiche Google Maps selon le périmètre et le calendrier du devis.",
    descriptionEn: "PUBLIC-MAP reviews, secures and optimizes your Google Maps listing according to the scope and schedule stated in the quote.",
  },
  {
    serviceId: "gbp_consulting",
    type: "INDIVIDUAL_SERVICE",
    category: "google_business_profile",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Conseil GBP",
    displayNameEn: "GBP Consulting",
    descriptionFr: "Un accompagnement expert pour structurer votre fiche, planifier les optimisations et garder votre profil actif dans le temps.",
    descriptionEn: "Expert support to structure your listing, plan optimizations and keep your profile active over time.",
  },
  {
    serviceId: "website_payment",
    type: "INDIVIDUAL_SERVICE",
    category: "website",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Pack site web vitrine + paiement",
    displayNameEn: "Showcase website + payment pack",
    descriptionFr: "Site web professionnel sur mesure livré selon le périmètre validé : mobile-first, SEO intégré et architecture prête pour une future intégration à un prestataire de paiement autorisé.",
    descriptionEn: "A custom professional website delivered to the approved scope: mobile-first, SEO-ready and architected for future integration with an authorised payment provider.",
  },
  {
    serviceId: "review_collection_setup",
    type: "INDIVIDUAL_SERVICE",
    category: "reviews_reputation",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Installation gestion des avis Google",
    displayNameEn: "Google review management setup",
    descriptionFr: "Système pour faciliter la collecte d'avis clients via QR Code, lien direct et relances encadrées, tout en respectant les règles Google.",
    descriptionEn: "A system to simplify customer review collection through QR code, direct link and guided follow-ups while respecting Google rules.",
  },
  {
    serviceId: "meta_social_setup",
    type: "INDIVIDUAL_SERVICE",
    category: "social_media",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Installation réseaux sociaux Meta",
    displayNameEn: "Meta social media setup",
    descriptionFr: "Configuration professionnelle de vos principaux réseaux sociaux pour présenter votre entreprise, suivre les campagnes et préparer votre calendrier de contenu.",
    descriptionEn: "Professional setup of your main social media profiles to present your business, track campaigns and prepare your content calendar.",
  },
  {
    serviceId: "seo_prestige",
    type: "INDIVIDUAL_SERVICE",
    category: "seo",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Pack SEO Prestige Canada",
    displayNameEn: "Prestige SEO Pack Canada",
    descriptionFr: "Stratégie SEO complète pour améliorer durablement votre visibilité sur Google : audit, mots-clés, contenu mensuel et acquisition de liens de qualité en méthode white-hat.",
    descriptionEn: "A complete SEO strategy to sustainably improve your Google visibility: audit, keywords, monthly content and quality white-hat link acquisition.",
  },
  {
    serviceId: "technical_support",
    type: "INDIVIDUAL_SERVICE",
    category: "technical_support",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Assistance technique premium",
    displayNameEn: "Premium technical support",
    descriptionFr: "Accompagnement technique annuel pour garder votre fiche propre, à jour et exploitable, avec suivi mensuel et support prioritaire en jours ouvrés.",
    descriptionEn: "Annual technical support to keep your listing clean, updated and usable, with monthly tracking and priority business-day support.",
  },
  {
    serviceId: "site_maintenance",
    type: "INDIVIDUAL_SERVICE",
    category: "website",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Maintenance & mise à jour site web",
    displayNameEn: "Website maintenance & updates",
    descriptionFr: "Maintenance annuelle pour garder votre site en ligne, sécurisé et à jour : hébergement, sauvegardes, suivi du domaine et modifications courantes selon le périmètre validé.",
    descriptionEn: "Annual maintenance to keep your website online, secure and updated: hosting, backups, domain tracking and routine edits according to the approved scope.",
  },
  {
    serviceId: "keywords_ai",
    type: "INDIVIDUAL_SERVICE",
    category: "seo",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Mots-clés additionnels — 10 cibles + IA",
    displayNameEn: "Additional keywords — 10 targets + AI",
    descriptionFr: "Ajoutez 10 mots-clés ciblés avec intégration IA pour analyser et sélectionner les recherches les plus pertinentes pour votre activité, par service, ville ou région.",
    descriptionEn: "Add 10 targeted keywords with AI integration to analyze and select the searches most relevant to your business, by service, city or region.",
  },
  {
    serviceId: "reviews_ai",
    type: "INDIVIDUAL_SERVICE",
    category: "reviews_reputation",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Gestion avis Google par IA",
    displayNameEn: "AI Google review management",
    descriptionFr: "Notre IA aide à surveiller vos avis, préparer des réponses professionnelles personnalisées et transformer vos retours clients en actions concrètes.",
    descriptionEn: "Our AI helps monitor your reviews, prepare personalized professional replies and turn customer feedback into concrete actions.",
  },
  {
    serviceId: "maps_products", // technical ID kept as-is per approved decision — never renamed
    type: "INDIVIDUAL_SERVICE",
    category: "google_business_profile",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Optimisation produits & services Google Business Profile",
    displayNameEn: "Google Business Profile Products & Services Optimization",
    descriptionFr: "Nous structurons vos produits, services, photos et textes pour rendre votre fiche Google plus claire, plus complète et plus utile aux clients.",
    descriptionEn: "We structure your products, services, photos and copy to make your Google listing clearer, more complete and more useful to customers.",
  },
  {
    serviceId: "local_visibility_express_audit",
    type: "INDIVIDUAL_SERVICE",
    category: "audit",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Audit express visibilité locale",
    displayNameEn: "Local visibility express audit",
    descriptionFr: "Un diagnostic rapide pour savoir quoi corriger en priorité sur votre fiche Google, votre site, vos avis et vos points de conversion.",
    descriptionEn: "A quick diagnosis to identify what to fix first on your Google listing, website, reviews and conversion points.",
  },
  {
    serviceId: "maps_ai_posts",
    type: "INDIVIDUAL_SERVICE",
    category: "google_business_profile",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Posts Google Maps par IA",
    displayNameEn: "AI Google Maps posts",
    descriptionFr: "L'IA prépare 8 posts Google Maps par mois pour garder votre fiche active : offres, actualités, événements et messages adaptés à votre marché.",
    descriptionEn: "AI prepares 8 Google Maps posts per month to keep your listing active: offers, updates, events and messages adapted to your market.",
  },
  {
    serviceId: "chatbot_ai",
    type: "INDIVIDUAL_SERVICE",
    category: "automation_crm",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Chatbot IA site web & Google",
    displayNameEn: "Website & Google AI chatbot",
    descriptionFr: "Un assistant IA répond aux questions fréquentes, qualifie les demandes et aide vos visiteurs à passer à l'action sur votre site ou votre fiche Google.",
    descriptionEn: "An AI assistant answers frequent questions, qualifies requests and helps visitors take action on your website or Google listing.",
  },
  {
    serviceId: "social_ai",
    type: "INDIVIDUAL_SERVICE",
    category: "social_media",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Gestion réseaux sociaux IA",
    displayNameEn: "AI social media management",
    descriptionFr: "L'IA aide à préparer, organiser et planifier du contenu professionnel chaque mois : textes, visuels, hashtags et idées adaptées à votre audience.",
    descriptionEn: "AI helps prepare, organize and plan professional content every month: copy, visuals, hashtags and ideas adapted to your audience.",
  },
  {
    serviceId: "crm_automation",
    type: "INDIVIDUAL_SERVICE",
    category: "automation_crm",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Automatisation IA & CRM Lead Capture",
    displayNameEn: "AI automation & CRM lead capture",
    descriptionFr: "Un système simple pour capter les demandes du site, les qualifier, les envoyer au bon endroit et préparer les relances sans perdre les prospects.",
    descriptionEn: "A simple system to capture website requests, qualify them, route them and prepare follow-ups without losing prospects.",
  },
  {
    serviceId: "logo_design",
    type: "INDIVIDUAL_SERVICE",
    category: "branding_design",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Création de logo d'entreprise",
    displayNameEn: "Business logo design",
    descriptionFr: "Un logo sur mesure, pensé pour votre activité et livré dans les formats utiles pour votre site, vos réseaux sociaux et vos supports imprimés.",
    descriptionEn: "A custom logo designed for your business and delivered in practical formats for your website, social media and printed materials.",
  },
  {
    serviceId: "google_maps_profile_optimization",
    type: "INDIVIDUAL_SERVICE",
    category: "google_business_profile",
    priceDerivation: "NOT_APPLICABLE",
    displayNameFr: "Optimisation IA fiche Google Maps",
    displayNameEn: "Google Maps Profile Optimization",
    descriptionFr: "L'IA analyse votre fiche Google Maps, identifie les failles prioritaires et prépare un plan d'optimisation clair. Vous obtenez une base plus propre pour améliorer les vues, les appels et les demandes d'itinéraire.",
    descriptionEn: "Review and optimize your Google Business Profile to improve the completeness, relevance and quality of the information customers can find about your business on Google Maps and Search.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },

  // ---- DUOS (6) ----
  // None of the duo cards ever had an English description anywhere in
  // index.html — only a short French teaser <p>. descriptionEn is null
  // for all 6 pending real source text (the English NAME was approved,
  // the description was not part of that approval).
  {
    serviceId: "duo_brand_foundation",
    type: "DUO",
    category: "combo",
    priceDerivation: "SUM_OF_CHILDREN",
    displayNameFr: "Logo professionnel + site vitrine",
    displayNameEn: "Professional Logo + Business Website",
    descriptionFr: "Une identité qui inspire confiance, puis un site conçu pour transformer les visites en demandes de devis.",
    descriptionEn: "Combine a professional visual identity with a business website to create a more consistent and credible online presence.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "duo_local_trust",
    type: "DUO",
    category: "combo",
    priceDerivation: "SUM_OF_CHILDREN",
    displayNameFr: "Fiche Google optimisée + avis IA",
    displayNameEn: "Google Business Profile + Review Management",
    descriptionFr: "Une fiche propre et fiable, complétée par une gestion régulière des réponses pour renforcer la confiance.",
    descriptionEn: "Combine Google Business Profile optimization with review management to strengthen your local presence and help build customer trust.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "duo_maps_activity",
    type: "DUO",
    category: "combo",
    priceDerivation: "SUM_OF_CHILDREN",
    displayNameFr: "Optimisation Maps IA + produits/services",
    displayNameEn: "Google Maps Optimization + Products & Services",
    descriptionFr: "Une fiche plus complète, des services bien présentés et des contenus utiles pour aider Google et les clients à comprendre votre offre.",
    descriptionEn: "Combine Google Maps profile optimization with structured products and services to make your business information more complete and useful to potential customers.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "duo_seo_growth",
    type: "DUO",
    category: "combo",
    priceDerivation: "SUM_OF_CHILDREN",
    displayNameFr: "SEO Prestige + mots-clés IA",
    displayNameEn: "Prestige SEO + Keyword Optimization",
    descriptionFr: "Le plan SEO construit la base ; les mots-clés ciblés élargissent les recherches utiles à votre activité.",
    descriptionEn: "Combine advanced SEO work with targeted keyword optimization to strengthen the structure, relevance and search visibility of your website.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "duo_lead_automation",
    type: "DUO",
    category: "combo",
    priceDerivation: "SUM_OF_CHILDREN",
    displayNameFr: "Réseaux sociaux IA + CRM automatisé",
    displayNameEn: "Social Media + CRM Automation",
    descriptionFr: "Du contenu pour attirer l'attention, puis un système simple pour capter, qualifier et relancer les prospects.",
    descriptionEn: "Combine social media activity with CRM automation to organize incoming leads and improve follow-up workflows.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
  {
    serviceId: "duo_digital_care",
    type: "DUO",
    category: "combo",
    priceDerivation: "SUM_OF_CHILDREN",
    displayNameFr: "Maintenance du site + assistance",
    displayNameEn: "Website Maintenance + Technical Support",
    descriptionFr: "Votre site et vos informations restent à jour, avec un interlocuteur pour les demandes techniques courantes.",
    descriptionEn: "Combine website maintenance with technical support to help keep your website operational, maintained and supported over time.",
    descriptionEnStatus: "HUMAN_APPROVED",
  },
];

// service_market_offers — 26 non-duo services x 2 markets = 52 rows.
// Duos never get a row here (PRICE_MODE = SUM_OF_CHILDREN, derived, not stored).
const CTA = "REQUEST_QUOTE";
const CHECKOUT = "MOCK";

export const MARKET_OFFERS = [
  // pack_gbp_seo_launch
  { serviceId: "pack_gbp_seo_launch", market: "CANADA", currency: "CAD", price: "390.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · lancement initial", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "pack_gbp_seo_launch", market: "EUROPE", currency: "EUR", price: "255.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TTC", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // pack_local_growth
  { serviceId: "pack_local_growth", market: "CANADA", currency: "CAD", price: "1490.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · suivi mensuel", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "pack_local_growth", market: "EUROPE", currency: "EUR", price: "990.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // pack_all_inclusive_prestige
  { serviceId: "pack_all_inclusive_prestige", market: "CANADA", currency: "CAD", price: "2990.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · renouvellement libre", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "pack_all_inclusive_prestige", market: "EUROPE", currency: "EUR", price: "1990.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // pack_website_automation
  { serviceId: "pack_website_automation", market: "CANADA", currency: "CAD", price: "2900.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · site + système IA", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "pack_website_automation", market: "EUROPE", currency: "EUR", price: "1990.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // pack_international_seo
  { serviceId: "pack_international_seo", market: "CANADA", currency: "CAD", price: "1590.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · services disponibles au Canada et en Europe", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "pack_international_seo", market: "EUROPE", currency: "EUR", price: "790.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · TTC", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // ads_campaigns_management — CANONICAL price per locked human decision (legacy 990/690 explicitly excluded)
  { serviceId: "ads_campaigns_management", market: "CANADA", currency: "CAD", price: "1290.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · budget publicitaire non inclus", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "ads_campaigns_management", market: "EUROPE", currency: "EUR", price: "890.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · budget publicitaire non inclus", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // ai_visibility
  { serviceId: "ai_visibility", market: "CANADA", currency: "CAD", price: "890.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · suivi trimestriel", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "ai_visibility", market: "EUROPE", currency: "EUR", price: "590.00", paymentFrequency: "ANNUAL", billingType: "paiement annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // gbp_owner_access_training
  { serviceId: "gbp_owner_access_training", market: "CANADA", currency: "CAD", price: "179.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · formation initiale", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "gbp_owner_access_training", market: "EUROPE", currency: "EUR", price: "129.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TTC", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // maps_security
  { serviceId: "maps_security", market: "CANADA", currency: "CAD", price: "690.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · calendrier selon devis", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "maps_security", market: "EUROPE", currency: "EUR", price: "459.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TTC", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // gbp_consulting
  { serviceId: "gbp_consulting", market: "CANADA", currency: "CAD", price: "275.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · accompagnement initial", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "gbp_consulting", market: "EUROPE", currency: "EUR", price: "265.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TTC", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // website_payment
  { serviceId: "website_payment", market: "CANADA", currency: "CAD", price: "2490.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · calendrier selon devis", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "website_payment", market: "EUROPE", currency: "EUR", price: "1690.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // review_collection_setup
  { serviceId: "review_collection_setup", market: "CANADA", currency: "CAD", price: "249.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · installation incluse", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "review_collection_setup", market: "EUROPE", currency: "EUR", price: "169.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // meta_social_setup
  { serviceId: "meta_social_setup", market: "CANADA", currency: "CAD", price: "499.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · calendrier selon devis", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "meta_social_setup", market: "EUROPE", currency: "EUR", price: "349.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // seo_prestige
  { serviceId: "seo_prestige", market: "CANADA", currency: "CAD", price: "1890.00", paymentFrequency: "ANNUAL", billingType: "annuel · plan 90 jours inclus", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "seo_prestige", market: "EUROPE", currency: "EUR", price: "1190.00", paymentFrequency: "ANNUAL", billingType: "annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // technical_support
  { serviceId: "technical_support", market: "CANADA", currency: "CAD", price: "450.00", paymentFrequency: "ANNUAL", billingType: "annuel · renouvellement libre", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "technical_support", market: "EUROPE", currency: "EUR", price: "290.00", paymentFrequency: "ANNUAL", billingType: "annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // site_maintenance
  { serviceId: "site_maintenance", market: "CANADA", currency: "CAD", price: "449.00", paymentFrequency: "ANNUAL", billingType: "annuel · renouvellement libre", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "site_maintenance", market: "EUROPE", currency: "EUR", price: "290.00", paymentFrequency: "ANNUAL", billingType: "annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // keywords_ai
  { serviceId: "keywords_ai", market: "CANADA", currency: "CAD", price: "299.00", paymentFrequency: "ANNUAL", billingType: "annuel · 10 mots-clés + IA", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "keywords_ai", market: "EUROPE", currency: "EUR", price: "199.00", paymentFrequency: "ANNUAL", billingType: "annuel · TTC", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // reviews_ai
  { serviceId: "reviews_ai", market: "CANADA", currency: "CAD", price: "290.00", paymentFrequency: "ANNUAL", billingType: "annuel · renouvellement libre", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "reviews_ai", market: "EUROPE", currency: "EUR", price: "190.00", paymentFrequency: "ANNUAL", billingType: "annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // maps_products
  { serviceId: "maps_products", market: "CANADA", currency: "CAD", price: "690.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · assistance 12 mois", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "maps_products", market: "EUROPE", currency: "EUR", price: "459.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TTC · assistance 12 mois", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // local_visibility_express_audit
  { serviceId: "local_visibility_express_audit", market: "CANADA", currency: "CAD", price: "249.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · audit actionnable", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "local_visibility_express_audit", market: "EUROPE", currency: "EUR", price: "179.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // maps_ai_posts
  { serviceId: "maps_ai_posts", market: "CANADA", currency: "CAD", price: "199.00", paymentFrequency: "ANNUAL", billingType: "annuel · 8 posts/mois inclus", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "maps_ai_posts", market: "EUROPE", currency: "EUR", price: "139.00", paymentFrequency: "ANNUAL", billingType: "annuel · TTC", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // chatbot_ai
  { serviceId: "chatbot_ai", market: "CANADA", currency: "CAD", price: "349.00", paymentFrequency: "ANNUAL", billingType: "annuel · renouvellement libre", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "chatbot_ai", market: "EUROPE", currency: "EUR", price: "229.00", paymentFrequency: "ANNUAL", billingType: "annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // social_ai
  { serviceId: "social_ai", market: "CANADA", currency: "CAD", price: "890.00", paymentFrequency: "ANNUAL", billingType: "annuel · renouvellement libre", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "social_ai", market: "EUROPE", currency: "EUR", price: "590.00", paymentFrequency: "ANNUAL", billingType: "annuel · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // crm_automation
  { serviceId: "crm_automation", market: "CANADA", currency: "CAD", price: "790.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · système de leads", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "crm_automation", market: "EUROPE", currency: "EUR", price: "590.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · TVA selon pays", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
  // logo_design
  { serviceId: "logo_design", market: "CANADA", currency: "CAD", price: "690.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · droits d'utilisation à vie", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "logo_design", market: "EUROPE", currency: "EUR", price: "449.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · droits d'utilisation à vie", taxDisplay: "TTC", ctaType: CTA, checkoutStatus: CHECKOUT },
  // google_maps_profile_optimization
  { serviceId: "google_maps_profile_optimization", market: "CANADA", currency: "CAD", price: "490.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · calendrier selon devis", taxDisplay: "UNSPECIFIED", ctaType: CTA, checkoutStatus: CHECKOUT },
  { serviceId: "google_maps_profile_optimization", market: "EUROPE", currency: "EUR", price: "329.00", paymentFrequency: "ONE_TIME", billingType: "paiement unique · calendrier selon devis", taxDisplay: "HT", ctaType: CTA, checkoutStatus: CHECKOUT },
];

// service_relations — 7 PACK_INCLUDES (human-confirmed only) + 12 DUO_INCLUDES.
// pack_local_growth -> pack_gbp_seo_launch is DELIBERATELY ABSENT (Option B,
// no pack-in-pack in P0). Its "Tout le Pack Lancement +" bullet stays in
// descriptionFr/features text only.
export const RELATIONS = [
  { parentServiceId: "pack_local_growth", childServiceId: "ai_visibility", relationType: "PACK_INCLUDES", displayOrder: 1 },

  { parentServiceId: "pack_all_inclusive_prestige", childServiceId: "seo_prestige", relationType: "PACK_INCLUDES", displayOrder: 1 },
  { parentServiceId: "pack_all_inclusive_prestige", childServiceId: "reviews_ai", relationType: "PACK_INCLUDES", displayOrder: 2 },
  { parentServiceId: "pack_all_inclusive_prestige", childServiceId: "maps_ai_posts", relationType: "PACK_INCLUDES", displayOrder: 3 },
  { parentServiceId: "pack_all_inclusive_prestige", childServiceId: "chatbot_ai", relationType: "PACK_INCLUDES", displayOrder: 4 },
  { parentServiceId: "pack_all_inclusive_prestige", childServiceId: "ai_visibility", relationType: "PACK_INCLUDES", displayOrder: 5 },

  { parentServiceId: "pack_international_seo", childServiceId: "ai_visibility", relationType: "PACK_INCLUDES", displayOrder: 1 },

  { parentServiceId: "duo_brand_foundation", childServiceId: "logo_design", relationType: "DUO_INCLUDES", displayOrder: 1 },
  { parentServiceId: "duo_brand_foundation", childServiceId: "website_payment", relationType: "DUO_INCLUDES", displayOrder: 2 },

  { parentServiceId: "duo_local_trust", childServiceId: "maps_security", relationType: "DUO_INCLUDES", displayOrder: 1 },
  { parentServiceId: "duo_local_trust", childServiceId: "reviews_ai", relationType: "DUO_INCLUDES", displayOrder: 2 },

  { parentServiceId: "duo_maps_activity", childServiceId: "maps_security", relationType: "DUO_INCLUDES", displayOrder: 1 },
  { parentServiceId: "duo_maps_activity", childServiceId: "maps_products", relationType: "DUO_INCLUDES", displayOrder: 2 },

  { parentServiceId: "duo_seo_growth", childServiceId: "seo_prestige", relationType: "DUO_INCLUDES", displayOrder: 1 },
  { parentServiceId: "duo_seo_growth", childServiceId: "keywords_ai", relationType: "DUO_INCLUDES", displayOrder: 2 },

  { parentServiceId: "duo_lead_automation", childServiceId: "crm_automation", relationType: "DUO_INCLUDES", displayOrder: 1 },
  { parentServiceId: "duo_lead_automation", childServiceId: "social_ai", relationType: "DUO_INCLUDES", displayOrder: 2 },

  { parentServiceId: "duo_digital_care", childServiceId: "site_maintenance", relationType: "DUO_INCLUDES", displayOrder: 1 },
  { parentServiceId: "duo_digital_care", childServiceId: "technical_support", relationType: "DUO_INCLUDES", displayOrder: 2 },
];

// service_legacy_identifiers — 30 entries, 0 collisions (each legacy string maps to exactly one SERVICE_ID)
export const LEGACY_IDENTIFIERS = [
  { serviceId: "ai_visibility", legacyIdentifier: "ai-visibility", source: "data-offer-id" },
  { serviceId: "maps_security", legacyIdentifier: "maps-security", source: "data-offer-id" },
  { serviceId: "website_payment", legacyIdentifier: "website-payment", source: "data-offer-id" },
  { serviceId: "website_payment", legacyIdentifier: "Pack site web vitrine + paiement", source: "panel exact-name" },
  { serviceId: "seo_prestige", legacyIdentifier: "seo-prestige", source: "data-offer-id" },
  { serviceId: "seo_prestige", legacyIdentifier: "Pack SEO Prestige Canada", source: "panel exact-name" },
  { serviceId: "seo_prestige", legacyIdentifier: "Pack SEO Prestige Europe", source: "panel exact-name" },
  { serviceId: "technical_support", legacyIdentifier: "technical-support", source: "data-offer-id" },
  { serviceId: "site_maintenance", legacyIdentifier: "site-maintenance", source: "data-offer-id" },
  { serviceId: "keywords_ai", legacyIdentifier: "keywords-ai", source: "data-offer-id" },
  { serviceId: "reviews_ai", legacyIdentifier: "reviews-ai", source: "data-offer-id" },
  { serviceId: "reviews_ai", legacyIdentifier: "Gestion avis Google par IA", source: "panel exact-name" },
  { serviceId: "maps_products", legacyIdentifier: "maps-products", source: "data-offer-id" },
  { serviceId: "maps_ai_posts", legacyIdentifier: "maps-ai-posts", source: "data-offer-id" },
  { serviceId: "chatbot_ai", legacyIdentifier: "chatbot-ai", source: "data-offer-id" },
  { serviceId: "social_ai", legacyIdentifier: "social-ai", source: "data-offer-id" },
  { serviceId: "social_ai", legacyIdentifier: "Gestion réseaux sociaux IA", source: "panel exact-name" },
  { serviceId: "crm_automation", legacyIdentifier: "crm-automation", source: "data-offer-id" },
  { serviceId: "logo_design", legacyIdentifier: "logo-design", source: "data-offer-id" },
  { serviceId: "pack_all_inclusive_prestige", legacyIdentifier: "Pack Tout-Inclus Prestige Canada", source: "panel exact-name" },
  { serviceId: "pack_all_inclusive_prestige", legacyIdentifier: "Pack Tout-Inclus Prestige Europe", source: "panel exact-name" },
  { serviceId: "ads_campaigns_management", legacyIdentifier: "Ads Performance", source: "addon-grid card name" },
  { serviceId: "ads_campaigns_management", legacyIdentifier: "Campagnes Google Ads & Meta Ads", source: "modal + panel exact-name" },
  { serviceId: "pack_international_seo", legacyIdentifier: "Référencement international — Canada et Europe + IA", source: "panel exact-name" },
  { serviceId: "duo_brand_foundation", legacyIdentifier: "brand-foundation", source: "data-offer-pair" },
  { serviceId: "duo_local_trust", legacyIdentifier: "local-trust", source: "data-offer-pair" },
  { serviceId: "duo_maps_activity", legacyIdentifier: "maps-activity", source: "data-offer-pair" },
  { serviceId: "duo_seo_growth", legacyIdentifier: "seo-growth", source: "data-offer-pair" },
  { serviceId: "duo_lead_automation", legacyIdentifier: "lead-automation", source: "data-offer-pair" },
  { serviceId: "duo_digital_care", legacyIdentifier: "digital-care", source: "data-offer-pair" },
];
