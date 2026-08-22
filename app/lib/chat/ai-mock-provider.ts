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
 * suggestion card in the widget's richer suggestion panel and per
 * follow-up sub-menu (GBP / Google Ads / SEO / website / automation /
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
 *
 * Phase 1D (free-text conversational fix): a real user reported that
 * typing "Salut"/"Hi" with no chip click fell through every branch above
 * into the generic unknown-fallback, which used to reply with an
 * "I'd rather not guess" message AND auto-open the lead form — wrong for
 * a bare greeting, and too aggressive for any unrecognized message in
 * general. Fixes, in order:
 *   1. A dedicated, anchored greeting match (isGreeting) runs first —
 *      never opens the lead form, always offers the main suggestions as
 *      optional shortcuts.
 *   2. A handful of new needles teach the EXISTING topic branches a few
 *      more natural phrasings — free text now routes correctly without
 *      requiring chip-exact wording.
 *   3. A pricing leaf gives a general explanation WITHOUT opening the
 *      lead form — "quote"/"human" appear only as ordinary suggestion
 *      chips the visitor can choose.
 *   4. The generic unknown-fallback itself no longer opens the lead form
 *      or claims uncertainty.
 * The lead form now opens ONLY for: an explicit "quote" or "human"
 * branch match (unchanged code, both already gated this way) — never
 * from a greeting, a general question, or the fallback.
 *
 * Phase 1E (conversational context): the widget was reported as feeling
 * like a support-ticket menu rather than a conversation — every message
 * immediately dumped a full sub-menu of cards. This adds a *stateless*
 * conversational layer on top of everything above:
 *   - extractContext() re-derives a small ConvContext (businessType,
 *     goal, hasWebsite, hasGoogleBusinessProfile) from `input.history` +
 *     the current message on EVERY call — there is no new table, no
 *     server-side session object; "memory" is exactly the message
 *     history already persisted by lib/chat/messages.ts and passed in
 *     via getRecentMessagesForProvider(), nothing more (§5 of the
 *     request: "pas de mémoire longue durée").
 *   - when a business type is named but no goal is known yet, the
 *     provider asks a short qualifying question instead of dumping
 *     suggestions (§2/§3) — closer to how a human would actually ask
 *     one clarifying question before recommending anything.
 *   - once both a business type AND a goal are known (from this message
 *     or an earlier one in the same conversation), replies reference
 *     that context explicitly ("Pour un restaurant, …") and suggestion
 *     chips are the small, relevant set for that context (§7), not the
 *     full catalog.
 *   - the website topic is restructured into two turns (new vs. redesign
 *     first, THEN the 5 site types) instead of asking and showing cards
 *     in the same turn — the one place §3 explicitly asks for this.
 * Every new branch is gated behind `isSite(input)`, exactly like Phase
 * 1C/1D — the in-app dashboard widget (surface "app"/undefined) is
 * completely unaffected, verified by tests.
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

// A greeting is matched only when the ENTIRE message (aside from
// trailing punctuation) IS the greeting — "Salut" or "Bonjour !" match,
// but "Bonjour, je voudrais un devis" deliberately does not, so it still
// falls through to the real "devis" branch below instead of being
// swallowed by a generic welcome reply.
const GREETING_PATTERN = /^(salut|bonjour|bonsoir|coucou|hello|hey|hi|good morning|good afternoon|good evening)[\s!.?]*$/;

function isGreeting(message: string): boolean {
  return GREETING_PATTERN.test(message);
}

const DEFAULT_SUGGESTIONS: AiSuggestion[] = [{ id: "google_ads" }, { id: "how_it_works" }, { id: "performance" }, { id: "account_help" }, { id: "human" }];

/**
 * Phase 1B: public-map.com visitors are anonymous prospects, not signed-in
 * dashboard users — "how_it_works"/"performance"/"account_help" all
 * presuppose an existing PUBLIC-MAP account, which reads oddly to someone
 * who hasn't signed up yet. Swaps in prospect-facing chips instead,
 * keeping "google_ads" and "human" since both already read naturally
 * pre-signup.
 */
const SITE_SUGGESTIONS: AiSuggestion[] = ids("gbp", "google_ads", "seo", "website", "automation", "quote");

function suggestionsFor(input: AiProviderInput): AiSuggestion[] {
  return isSite(input) ? SITE_SUGGESTIONS : DEFAULT_SUGGESTIONS;
}

// ---- Phase 1E: conversational context ---------------------------------

type BusinessType = "ecommerce" | "restaurant" | "hotel" | "doctor" | "lawyer" | "shop" | "agency" | "local_business";
type Goal = "more_bookings" | "more_calls" | "automation" | "reviews" | "seo" | "ads" | "website" | "google_visibility" | "more_customers";

type ConvContext = {
  businessType?: BusinessType;
  goal?: Goal;
  hasWebsite?: boolean;
  hasGoogleBusinessProfile?: boolean;
};

// Checked in order — "ecommerce" before "shop" so "boutique en ligne"
// (French for online store) doesn't get shadowed by the shorter, more
// generic "boutique" needle used for a physical shop.
const BUSINESS_TYPE_MATCHERS: Array<[BusinessType, string[]]> = [
  ["ecommerce", ["e-commerce", "ecommerce", "boutique en ligne", "online store"]],
  ["restaurant", ["restaurant"]],
  ["hotel", ["hôtel", "hotel"]],
  ["doctor", ["médecin", "docteur", "cabinet médical", "doctor", "medical practice", "clinic"]],
  ["lawyer", ["avocat", "cabinet d'avocat", "lawyer", "law firm", "attorney"]],
  ["shop", ["boutique", "magasin", "shop", "store"]],
  ["agency", ["agence", "agency"]],
  ["local_business", ["commerce local", "local business"]],
];

// Checked in order — more specific goals (bookings/calls) before the
// generic "more_customers" catch-all, so "plus de réservations" resolves
// to more_bookings rather than the broader "plus de clients" pattern.
const GOAL_MATCHERS: Array<[Goal, string[]]> = [
  ["more_bookings", ["plus de réservations", "recevoir plus de réservations", "more bookings", "more reservations"]],
  ["more_calls", ["plus d'appels", "more calls"]],
  ["automation", ["automatiser", "automation", "automate", "automatisation", "ai automation"]],
  ["reviews", ["plus d'avis", "avis clients", "more reviews", "customer reviews"]],
  ["seo", ["référencement", "seo"]],
  ["ads", ["google ads", "publicité", "pubs google", "adwords", "ads", "campagne", "campaign"]],
  ["website", ["créer un site", "site web", "website", "landing page", "créer mon site", "améliorer mon site"]],
  ["google_visibility", ["visibilité sur google", "visibilité google", "google visibility", "apparaître davantage sur google maps", "google maps"]],
  ["more_customers", ["plus de clients", "plus de prospects", "more customers", "more clients", "more leads", "generate more leads", "générer plus de prospects"]],
];

function detectBusinessType(text: string): BusinessType | undefined {
  for (const [type, needles] of BUSINESS_TYPE_MATCHERS) {
    if (matchesAny(text, needles)) return type;
  }
  return undefined;
}

function detectGoal(text: string): Goal | undefined {
  for (const [goal, needles] of GOAL_MATCHERS) {
    if (matchesAny(text, needles)) return goal;
  }
  return undefined;
}

function detectHasWebsite(text: string): boolean | undefined {
  if (matchesAny(text, ["je n'ai pas de site", "pas encore de site", "no website", "don't have a website", "do not have a website"])) return false;
  if (matchesAny(text, ["j'ai déjà un site", "j'ai un site", "already have a website", "i have a website"])) return true;
  return undefined;
}

function detectHasGbp(text: string): boolean | undefined {
  if (matchesAny(text, ["pas de fiche google", "no google business profile", "don't have a google business profile"])) return false;
  if (matchesAny(text, ["j'ai déjà une fiche google", "j'ai une fiche google", "already have a google business profile", "i have a google business profile"])) return true;
  return undefined;
}

/**
 * Re-derives context from the bounded, oldest-first history window
 * (lib/chat/messages.ts::getRecentMessagesForProvider) plus the current
 * message — no persistence beyond what's already stored per §5. The
 * CURRENT message's own signal always wins over older history so a
 * correction ("actually it's a hotel, not a restaurant") takes effect
 * immediately.
 */
function extractContext(history: AiProviderInput["history"], currentMessage: string): ConvContext {
  const priorTexts = history.filter((m) => m.senderType !== "assistant").map((m) => m.content.trim().toLowerCase());
  const allTexts = [...priorTexts, currentMessage];

  let businessType: BusinessType | undefined;
  let goal: Goal | undefined;
  let hasWebsite: boolean | undefined;
  let hasGoogleBusinessProfile: boolean | undefined;
  for (const text of allTexts) {
    businessType = detectBusinessType(text) ?? businessType;
    goal = detectGoal(text) ?? goal;
    hasWebsite = detectHasWebsite(text) ?? hasWebsite;
    hasGoogleBusinessProfile = detectHasGbp(text) ?? hasGoogleBusinessProfile;
  }
  return { businessType, goal, hasWebsite, hasGoogleBusinessProfile };
}

function lastAssistantMessage(history: AiProviderInput["history"]): string | undefined {
  for (let i = history.length - 1; i >= 0; i--) {
    if (history[i].senderType === "assistant") return history[i].content;
  }
  return undefined;
}

const BUSINESS_LABELS: Record<BusinessType, { fr: string; en: string }> = {
  ecommerce: { fr: "une boutique en ligne", en: "an online store" },
  restaurant: { fr: "un restaurant", en: "a restaurant" },
  hotel: { fr: "un hôtel", en: "a hotel" },
  doctor: { fr: "un cabinet médical", en: "a medical practice" },
  lawyer: { fr: "un cabinet d'avocat", en: "a law firm" },
  shop: { fr: "une boutique", en: "a shop" },
  agency: { fr: "une agence", en: "an agency" },
  local_business: { fr: "un commerce local", en: "a local business" },
};

const GOAL_LABELS: Record<Goal, { fr: string; en: string }> = {
  more_bookings: { fr: "l'augmentation de vos réservations", en: "increasing your bookings" },
  more_calls: { fr: "l'augmentation de vos appels", en: "increasing your calls" },
  automation: { fr: "l'automatisation de votre activité", en: "automating your business" },
  reviews: { fr: "l'obtention de plus d'avis clients", en: "getting more customer reviews" },
  seo: { fr: "votre référencement", en: "your SEO" },
  ads: { fr: "vos campagnes publicitaires", en: "your ad campaigns" },
  website: { fr: "votre site web", en: "your website" },
  google_visibility: { fr: "votre visibilité sur Google", en: "your Google visibility" },
  more_customers: { fr: "l'acquisition de nouveaux clients", en: "gaining new customers" },
};

/** "Pour un restaurant, " / "For a restaurant, " — empty when the
 * business type isn't known yet, so callers can prepend it unconditionally. */
function contextPrefix(context: ConvContext, locale: "fr" | "en"): string {
  if (!context.businessType) return "";
  const label = BUSINESS_LABELS[context.businessType][locale];
  return locale === "en" ? `For ${label}, ` : `Pour ${label}, `;
}

const BUSINESS_QUALIFYING: Record<BusinessType, { fr: string; en: string }> = {
  restaurant: {
    fr: "Très bien. Pour un restaurant, on peut généralement travailler sur plusieurs leviers : Google Maps / Business Profile, SEO local, avis clients et Google Ads.\n\nVotre priorité est plutôt :\n1. apparaître davantage sur Google Maps,\n2. recevoir plus de réservations,\n3. ou lancer de la publicité ?",
    en: "Great. For a restaurant, there are usually several levers to work with: Google Maps / Business Profile, local SEO, customer reviews and Google Ads.\n\nIs your priority more to:\n1. show up more on Google Maps,\n2. get more reservations,\n3. or launch advertising?",
  },
  hotel: {
    fr: "Très bien. Vous cherchez surtout plus de réservations ou une meilleure visibilité sur Google ?",
    en: "Great. Are you mainly looking for more bookings or better visibility on Google?",
  },
  doctor: {
    fr: "D'accord. Pour un cabinet médical, cherchez-vous surtout plus de nouveaux patients, ou une meilleure visibilité locale ?",
    en: "Got it. For a medical practice, are you mainly looking for more new patients, or better local visibility?",
  },
  lawyer: {
    fr: "D'accord. Pour un cabinet d'avocat, cherchez-vous surtout plus de nouveaux clients, ou une meilleure visibilité en ligne ?",
    en: "Got it. For a law firm, are you mainly looking for more new clients, or better online visibility?",
  },
  shop: {
    fr: "D'accord. Pour votre boutique, cherchez-vous surtout plus de visites en magasin, ou plus de ventes en ligne ?",
    en: "Got it. For your shop, are you mainly looking for more in-store visits, or more online sales?",
  },
  ecommerce: {
    fr: "D'accord. Pour votre boutique en ligne, cherchez-vous surtout plus de trafic, ou un meilleur taux de conversion ?",
    en: "Got it. For your online store, are you mainly looking for more traffic, or a better conversion rate?",
  },
  agency: {
    fr: "D'accord. Pour votre agence, cherchez-vous surtout plus de prospects qualifiés, ou une meilleure visibilité de votre marque ?",
    en: "Got it. For your agency, are you mainly looking for more qualified leads, or better brand visibility?",
  },
  local_business: {
    fr: "D'accord. Pour votre commerce, cherchez-vous surtout plus de visibilité locale, ou plus de clients directement ?",
    en: "Got it. For your business, are you mainly looking for more local visibility, or more customers directly?",
  },
};

const GOAL_LEVERS: Record<Goal, { fr: string; en: string }> = {
  more_bookings: { fr: "Google Ads, Google Maps et votre système de réservation", en: "Google Ads, Google Maps and your booking system" },
  more_calls: { fr: "Google Ads avec extension d'appel, votre fiche Google Business Profile et un suivi des appels", en: "call-focused Google Ads, your Google Business Profile and call tracking" },
  automation: { fr: "l'automatisation de vos prospects, de votre support client et de votre CRM", en: "automating your leads, customer support and CRM" },
  reviews: { fr: "la collecte et la gestion de vos avis clients", en: "collecting and managing your customer reviews" },
  seo: { fr: "votre SEO local, votre contenu et la partie technique de votre site", en: "local SEO, your content and your site's technical setup" },
  ads: { fr: "vos campagnes Google Ads et votre suivi des conversions", en: "your Google Ads campaigns and conversion tracking" },
  website: { fr: "le type de site le plus adapté à votre activité", en: "the type of website best suited to your business" },
  google_visibility: { fr: "votre fiche Google Business Profile, votre SEO local et vos avis clients", en: "your Google Business Profile, local SEO and customer reviews" },
  more_customers: { fr: "votre fiche Google Business Profile, vos avis clients et Google Ads", en: "your Google Business Profile, customer reviews and Google Ads" },
};

function contextualSuggestions(context: ConvContext): AiSuggestion[] {
  // Hospitality-style businesses share the same short, high-signal set
  // regardless of the exact goal (§7's explicit "restaurant" example).
  if (context.businessType === "restaurant" || context.businessType === "hotel") {
    return ids("gbp", "reviews", "google_ads", "website_booking");
  }
  switch (context.goal) {
    case "website":
      return ids("website_showcase", "website_ecommerce", "website_booking", "website_landing");
    case "automation":
      return ids("automation_leads", "automation_emails", "automation_whatsapp", "automation_crm", "automation_integrations");
    case "seo":
      return ids("seo_local", "seo_technical", "seo_audit");
    case "ads":
      return ids("ads_new_campaign", "ads_audit", "ads_conversion_tracking");
    case "reviews":
      return ids("gbp_reviews", "quote", "human");
    case "google_visibility":
      return ids("gbp", "seo", "google_ads");
    case "more_calls":
      return ids("google_ads", "gbp", "quote");
    default:
      return ids("gbp", "google_ads", "seo", "quote");
  }
}

// Goals that have NO dedicated topic branch of their own (gbp/ads/seo/
// website/automation all already exist as full branches below, now
// context-aware via contextPrefix/contextualSuggestions) — only these
// trigger the generic "Dans ce cas, je regarderais en priorité…"
// response. Without this allowlist, a stale goal left over from earlier
// in the conversation (e.g. "automation" from 2 turns ago) would hijack
// an unrelated later message like "Et Google Ads ?" or a human-escalation
// request instead of letting the real, more specific branch handle it.
const GENERIC_CONTEXTUAL_GOALS: Goal[] = ["more_bookings", "more_calls", "more_customers", "reviews", "google_visibility"];

/**
 * A topic branch (gbp/ads/seo/automation/website) shows its full,
 * detailed sub-menu when nothing is known about the visitor yet
 * (matches every existing Phase 1C test, run with empty history) — but
 * once a business type is known, showing the SAME 6-9 cards again would
 * repeat the very "menu de support" problem this phase set out to fix.
 * In that case, fall back to the same small, contextual set §7 asks for.
 */
function topicSuggestions(input: AiProviderInput, context: ConvContext, forcedGoal: Goal, fullMenu: AiSuggestion[]): AiSuggestion[] {
  if (!isSite(input)) return suggestionsFor(input);
  if (context.businessType) return contextualSuggestions({ ...context, goal: forcedGoal });
  return fullMenu;
}

// ---- Phase 1C: public-map.com sub-flow catalog -----------------------
// Every array below is a closed, hand-picked set of ids — never
// generated/free-form — so a leaf always resolves to a real, tested
// branch. "quote" and "human" are reused as-is everywhere: both already
// have dedicated branches below (unchanged) that show the existing lead
// form / human-escalation path, so a conversation started from any
// sub-menu always converges on the same real capture mechanism rather
// than a dead end.
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
  "automation_integrations",
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
 * (e.g. English "Keyword research" contains "search"). Pricing is NOT
 * here — see the dedicated, context-aware pricing branch in
 * generateReply, which needs access to ConvContext.
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

  // --- Website sub-menu (reached only after the new-vs-redesign follow-up
  // below, or by clicking a type card directly) ---------------------------
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
  { needles: ["n8n / webhooks", "n8n/webhooks"], fr: "PUBLIC-MAP peut connecter tous vos outils entre eux (n8n, webhooks, API) pour que rien ne passe entre les mailles du filet.", en: "PUBLIC-MAP can connect all your tools together (n8n, webhooks, API) so nothing falls through the cracks." },
  { needles: ["voir des exemples", "see examples"], fr: "Quelques exemples concrets : qualification automatique d'un prospect entrant, relance automatique après un rendez-vous manqué, réponse automatique en dehors des heures d'ouverture, synchronisation CRM et formulaires via webhook.", en: "A few concrete examples: automatic qualification of an incoming lead, automatic follow-up after a missed appointment, automatic replies outside business hours, and CRM-to-forms syncing via webhook." },

  // --- Lead generation sub-menu (new leaves only — Google Ads/SEO/landing
  // page/lead automation/CRM reuse the branches above) --------------------
  { needles: ["formulaires", "forms"], fr: "PUBLIC-MAP peut créer des formulaires intelligents qui captent et qualifient automatiquement vos prospects.", en: "PUBLIC-MAP can build smart forms that automatically capture and qualify your leads." },
  { needles: ["qualification automatique", "automatic qualification"], fr: "PUBLIC-MAP peut qualifier automatiquement vos prospects selon vos propres critères, pour que votre équipe se concentre sur les plus prometteurs.", en: "PUBLIC-MAP can automatically qualify your leads against your own criteria, so your team focuses on the most promising ones." },

  // --- Topics without their own numbered sous-parcours --------------------
  { needles: ["avis clients", "customer reviews"], fr: "PUBLIC-MAP peut vous aider à obtenir plus d'avis clients et à améliorer votre note moyenne sur Google — un levier clé de confiance et de visibilité locale.", en: "PUBLIC-MAP can help you get more customer reviews and improve your average Google rating — a key trust and local-visibility driver.", suggestions: REVIEWS_SUGGESTIONS },
  {
    needles: ["développer ma visibilité", "grow my visibility"],
    fr: "Très bien. Pour développer votre visibilité, les leviers principaux sont votre fiche Google Business Profile, votre SEO et vos campagnes Google Ads. Par lequel souhaitez-vous commencer ?",
    en: "Great. To grow your visibility, the main levers are your Google Business Profile, your SEO, and your Google Ads campaigns. Which one would you like to start with?",
    suggestions: ids("gbp", "seo", "google_ads"),
  },
  {
    needles: ["générer plus de prospects", "generate more leads", "plus de clients", "more customers", "more clients"],
    fr: "PUBLIC-MAP peut vous aider à générer plus de prospects grâce à Google Ads, au SEO, à des landing pages optimisées, des formulaires intelligents et une automatisation complète de vos leads. Par où souhaitez-vous commencer ?",
    en: "PUBLIC-MAP can help you generate more leads through Google Ads, SEO, optimized landing pages, smart forms, and full lead automation. Where would you like to start?",
    suggestions: LEAD_GENERATION_SUB_SUGGESTIONS,
  },
  { needles: ["voir les services", "see services", "voir toutes les options", "see all options"], fr: "Voici nos principaux domaines d'intervention. Sur lequel souhaitez-vous en savoir plus ?", en: "Here are our main areas of expertise. Which one would you like to know more about?", suggestions: SITE_SUGGESTIONS },

  // Kept last — the shortest/most generic needle in this table (see the
  // comment above SITE_LEAVES).
  { needles: ["search"], fr: "Les campagnes Search ciblent les recherches actives de vos clients potentiels sur Google. PUBLIC-MAP peut mettre cela en place pour vous.", en: "Search campaigns target your potential customers' active searches on Google. PUBLIC-MAP can set this up for you." },
];

// Distinctive substring of the website-topic branch's new-vs-redesign
// question (below) — used to detect, from lib/chat/messages.ts history,
// that the PREVIOUS assistant turn was this specific question, so a
// short one-word answer ("Nouveau" / "Refonte") can be resolved without
// re-stating the whole topic.
const WEBSITE_QUALIFY_MARKER_FR = "partez de zéro";
const WEBSITE_QUALIFY_MARKER_EN = "starting from scratch";

// Phase 1D: the fallback used to claim uncertainty AND auto-open the
// lead form for every unrecognized message — including a bare "Salut".
// Phase 1E softens the copy further per §11 ("pas encore assez
// d'informations… que souhaitez-vous améliorer ?") — "human" stays an
// ordinary chip, never the default response when the mock doesn't
// understand something.
function unknownFallback(locale: "fr" | "en"): string {
  return locale === "en"
    ? "I don't have enough context yet to guide you precisely. What would you like to improve in your business?"
    : "Je n'ai pas encore assez d'informations pour vous orienter précisément. Pouvez-vous me dire ce que vous souhaitez améliorer dans votre activité ?";
}

function fallbackSuggestions(input: AiProviderInput): AiSuggestion[] {
  return isSite(input) ? ids("browse_services", "human") : DEFAULT_SUGGESTIONS;
}

async function generateReply(input: AiProviderInput): Promise<AiProviderOutput> {
  const locale = input.locale;
  const message = input.userMessage.trim().toLowerCase();

  if (message === ERROR_SIMULATION_TRIGGER) {
    throw new Error("mock-provider: simulated error (test sentinel)");
  }

  if (isGreeting(message)) {
    return {
      reply:
        locale === "en"
          ? "👋 Hi! Welcome to PUBLIC-MAP.\nHow can I help you today?"
          : "👋 Bonjour ! Ravi de vous accueillir chez PUBLIC-MAP.\nComment puis-je vous aider aujourd'hui ?",
      suggestions: suggestionsFor(input),
    };
  }

  const context = isSite(input) ? extractContext(input.history, message) : {};
  const currentBusinessType = isSite(input) ? detectBusinessType(message) : undefined;
  const currentGoal = isSite(input) ? detectGoal(message) : undefined;

  // --- Website: new-vs-redesign is asked and answered over two turns —
  // the one flow §3 explicitly asks to restructure this way. Checked
  // before everything else so a short "Nouveau"/"Refonte" answer (too
  // generic to safely route on its own) resolves correctly.
  if (isSite(input)) {
    const lastReply = lastAssistantMessage(input.history);
    const justAskedNewOrRedesign = !!lastReply && (lastReply.includes(WEBSITE_QUALIFY_MARKER_FR) || lastReply.includes(WEBSITE_QUALIFY_MARKER_EN));
    if (justAskedNewOrRedesign) {
      const websiteTypeSuggestions = context.businessType ? contextualSuggestions({ ...context, goal: "website" }) : WEBSITE_SUB_SUGGESTIONS;
      if (matchesAny(message, ["nouveau", "zéro", "from scratch", "new site", "new website", "new"])) {
        return {
          reply: locale === "en" ? "Got it. What type of website would you like?" : "D'accord. Quel type de site souhaitez-vous ?",
          suggestions: websiteTypeSuggestions,
        };
      }
      if (matchesAny(message, ["refonte", "redesign", "déjà un site", "already have", "existing website", "existing site"])) {
        return {
          reply: locale === "en" ? "Understood, let's redesign it. What type of website would you like?" : "Compris, on va la refaire. Quel type de site souhaitez-vous ?",
          suggestions: websiteTypeSuggestions,
        };
      }
    }
  }

  // --- A business type was just named and we don't know the goal yet:
  // ask ONE qualifying question instead of dumping suggestions (§2/§4).
  if (isSite(input) && currentBusinessType && !context.goal) {
    const q = BUSINESS_QUALIFYING[currentBusinessType];
    return { reply: locale === "en" ? q.en : q.fr, suggestions: [] };
  }

  // --- The CURRENT message states a goal that has no dedicated topic
  // branch of its own (more_bookings/more_calls/more_customers/reviews/
  // google_visibility), and a business type is already known (from this
  // message or an earlier one) — give a contextual recommendation with a
  // small, relevant suggestion set (§4/§7), never the global catalog.
  // Gated on the CURRENT message's own goal (not the cumulative one) so
  // a stale goal from earlier in the conversation never hijacks a later,
  // unrelated message (e.g. a topic follow-up or a human-escalation
  // request) that has its own, more specific branch further down.
  if (isSite(input) && context.businessType && currentGoal && GENERIC_CONTEXTUAL_GOALS.includes(currentGoal)) {
    const levers = GOAL_LEVERS[currentGoal][locale];
    return {
      reply: locale === "en" ? `In that case, I'd look first at ${levers}.` : `Dans ce cas, je regarderais en priorité ${levers}.`,
      suggestions: contextualSuggestions({ ...context, goal: currentGoal }),
    };
  }

  // --- Pricing: context-aware, but the SAME rule as before applies —
  // this NEVER opens the lead form. "quote"/"human" are ordinary chips.
  if (matchesAny(message, ["combien ça coûte", "combien coûte", "prix", "tarif", "how much", "pricing", "cost"])) {
    const focus = context.businessType ? BUSINESS_LABELS[context.businessType][locale] : context.goal ? GOAL_LABELS[context.goal][locale] : undefined;
    const reply = focus
      ? locale === "en"
        ? `For ${focus}, pricing depends on the levers we use (SEO, Google Ads, Google Business Profile, automation...). I can put you in touch with an advisor for a personalized quote, or tell me what interests you most.`
        : `Pour ${focus}, nos tarifs dépendent des leviers utilisés (SEO, Google Ads, Google Business Profile, automatisation...). Je peux vous mettre en relation avec un conseiller pour un devis personnalisé, ou dites-moi ce qui vous intéresse le plus.`
      : locale === "en"
        ? "Our pricing depends on your needs (SEO, Google Ads, website, automation...). I can put you in touch with an advisor for a personalized quote, or tell me what interests you most."
        : "Nos tarifs dépendent de vos besoins (SEO, Google Ads, site web, automatisation...). Je peux vous mettre en relation avec un conseiller pour un devis personnalisé, ou dites-moi ce qui vous intéresse le plus.";
    return { reply, suggestions: ids("quote", "human") };
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

  if (matchesAny(message, ["contacter", "être contacté", "contact me", "devis", "quote", "rappeler", "rappelez", "call me back"])) {
    return {
      reply:
        locale === "en"
          ? "Of course — I can have a PUBLIC-MAP advisor reach out to you. Could you leave me your contact details?"
          : "Bien sûr — je peux faire en sorte qu'un conseiller PUBLIC-MAP vous contacte. Pouvez-vous me laisser vos coordonnées ?",
      action: { type: "show_lead_form" },
    };
  }

  if (matchesAny(message, ["google business profile", "gbp", "fiche établissement", "fiche google", "business profile", "google maps"])) {
    return {
      reply:
        contextPrefix(context, locale) +
        (locale === "en"
          ? "PUBLIC-MAP can help you optimize your Google Business Profile. Would you like to improve your local visibility, your business information, your customer reviews, or your overall performance?"
          : "PUBLIC-MAP peut vous accompagner dans l'optimisation de votre profil Google Business. Souhaitez-vous améliorer votre visibilité locale, vos informations, vos avis clients ou vos performances générales ?"),
      suggestions: isSite(input) ? (context.businessType ? contextualSuggestions(context) : GBP_SUB_SUGGESTIONS) : suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["google ads", "campagne", "campaign", "publicité", "ads", "adwords", "pubs google"])) {
    return {
      reply:
        contextPrefix(context, locale) +
        (locale === "en"
          ? "PUBLIC-MAP can help you set up and monitor Google Ads campaigns. To start, what's your main goal: getting leads, generating calls, selling online, or increasing visibility?"
          : "PUBLIC-MAP peut vous accompagner dans la création et le suivi de campagnes Google Ads. Pour commencer, quel est votre principal objectif : obtenir des prospects, générer des appels, vendre en ligne ou augmenter votre visibilité ?"),
      suggestions: topicSuggestions(input, context, "ads", ADS_SUB_SUGGESTIONS),
    };
  }

  if (matchesAny(message, ["seo", "référencement", "search console", "classement", "ranking"])) {
    return {
      reply:
        contextPrefix(context, locale) +
        (locale === "en"
          ? "PUBLIC-MAP can help improve your local and national SEO, and track your Google Search Console performance. Would you like to focus on local search, national search, or technical SEO?"
          : "PUBLIC-MAP peut vous aider à améliorer votre référencement local et national, et suivre vos performances Google Search Console. Souhaitez-vous vous concentrer sur le référencement local, national ou technique ?"),
      suggestions: topicSuggestions(input, context, "seo", SEO_SUB_SUGGESTIONS),
    };
  }

  if (matchesAny(message, ["site web", "website", "landing page", "créer mon site", "improve my website", "build a website", "créer un site", "améliorer mon site"])) {
    if (isSite(input)) {
      // Two turns, deliberately: ask new-vs-redesign here (no cards yet —
      // they wouldn't help until we know which), then the website-
      // followup branch above shows the 5 site types on the NEXT message.
      return {
        reply: locale === "en" ? "Sure. Are you starting from scratch or do you already have a website to redesign?" : "Bien sûr. Est-ce que vous partez de zéro ou vous avez déjà un site à refaire ?",
        suggestions: [],
      };
    }
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP can help you create or improve your website and landing pages. Do you already have a website, or are you starting from scratch?"
          : "PUBLIC-MAP peut vous accompagner pour créer ou améliorer votre site web et vos landing pages. Avez-vous déjà un site, ou partez-vous de zéro ?",
      suggestions: suggestionsFor(input),
    };
  }

  if (matchesAny(message, ["automatiser", "automation", "automate", "intégration", "n8n", "webhook", "automatisation", "business automation"])) {
    return {
      reply: isSite(input)
        ? contextPrefix(context, locale) +
          (locale === "en"
            ? "PUBLIC-MAP can automate many parts of your business using AI, for example:\n• Automatic handling of customer requests\n• Automatic lead qualification\n• Automated replies (website, WhatsApp, email)\n• CRM workflows and automated follow-ups\n• Smart forms\n• Automatic report generation\n• Syncing your tools together (n8n, webhooks, API)\n• Automating admin tasks\n\nWhat would you like to automate first?"
            : "PUBLIC-MAP peut automatiser de nombreuses tâches de votre entreprise grâce à l'IA, par exemple :\n• Traitement automatique des demandes clients\n• Qualification automatique des prospects\n• Réponses automatiques (site, WhatsApp, email)\n• Workflows CRM et relances automatiques\n• Formulaires intelligents\n• Génération automatique de rapports\n• Synchronisation de vos outils (n8n, webhooks, API)\n• Automatisation de tâches administratives\n\nQu'aimeriez-vous automatiser en premier ?")
        : locale === "en"
          ? "PUBLIC-MAP can help automate parts of your business and connect your tools together. What would you like to automate first?"
          : "PUBLIC-MAP peut vous aider à automatiser certaines tâches de votre entreprise et à connecter vos outils. Qu'aimeriez-vous automatiser en premier ?",
      suggestions: topicSuggestions(input, context, "automation", AUTOMATION_SUB_SUGGESTIONS),
    };
  }

  if (matchesAny(message, ["performance", "résultats", "results", "statistiques", "stats", "analytics"])) {
    return {
      reply: isSite(input)
        ? contextPrefix(context, locale) +
          (locale === "en"
            ? "PUBLIC-MAP can analyze your digital performance: local visibility (Google Business Profile), SEO, advertising campaigns (Google Ads), and your website traffic. Which area would you like an assessment of first?"
            : "PUBLIC-MAP peut analyser vos performances digitales : visibilité locale (Google Business Profile), référencement (SEO), campagnes publicitaires (Google Ads) et trafic de votre site. Sur quel point souhaitez-vous un état des lieux ?")
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

  return { reply: unknownFallback(locale), suggestions: fallbackSuggestions(input) };
}

export const mockAiProvider: AiProvider = { generateReply };
