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
 */

const ERROR_SIMULATION_TRIGGER = "test_simulate_provider_error";

function matchesAny(message: string, needles: string[]): boolean {
  return needles.some((needle) => message.includes(needle));
}

const DEFAULT_SUGGESTIONS: AiSuggestion[] = [{ id: "google_ads" }, { id: "how_it_works" }, { id: "performance" }, { id: "account_help" }, { id: "human" }];

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
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  if (matchesAny(message, ["google ads", "campagne", "campaign", "publicité", "ads", "adwords"])) {
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP can help you set up and monitor Google Ads campaigns. To start, what's your main goal: getting leads, generating calls, selling online, or increasing visibility?"
          : "PUBLIC-MAP peut vous accompagner dans la création et le suivi de campagnes Google Ads. Pour commencer, quel est votre principal objectif : obtenir des prospects, générer des appels, vendre en ligne ou augmenter votre visibilité ?",
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  if (matchesAny(message, ["seo", "référencement", "search console", "classement", "ranking"])) {
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP can help improve your local and national SEO, and track your Google Search Console performance. Would you like to focus on local search, national search, or technical SEO?"
          : "PUBLIC-MAP peut vous aider à améliorer votre référencement local et national, et suivre vos performances Google Search Console. Souhaitez-vous vous concentrer sur le référencement local, national ou technique ?",
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  if (matchesAny(message, ["site web", "website", "landing page", "créer mon site", "improve my website", "build a website"])) {
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP can help you create or improve your website and landing pages. Do you already have a website, or are you starting from scratch?"
          : "PUBLIC-MAP peut vous accompagner pour créer ou améliorer votre site web et vos landing pages. Avez-vous déjà un site, ou partez-vous de zéro ?",
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  if (matchesAny(message, ["automatiser", "automation", "automate", "intégration", "n8n", "webhook"])) {
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP can help automate parts of your business and connect your tools together. What would you like to automate first?"
          : "PUBLIC-MAP peut vous aider à automatiser certaines tâches de votre entreprise et à connecter vos outils. Qu'aimeriez-vous automatiser en premier ?",
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  if (matchesAny(message, ["performance", "résultats", "results", "statistiques", "stats", "analytics"])) {
    return {
      reply:
        locale === "en"
          ? "You can track your performance directly from your PUBLIC-MAP dashboard — Google Business Profile, Search Console, Analytics, and Google Ads all have their own section. Would you like help finding one of them?"
          : "Vous pouvez suivre vos performances directement depuis votre tableau de bord PUBLIC-MAP — Google Business Profile, Search Console, Analytics et Google Ads ont chacun leur propre section. Voulez-vous de l'aide pour retrouver l'une d'elles ?",
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  if (matchesAny(message, ["comment fonctionne", "how does", "fonctionnement", "how it works"])) {
    return {
      reply:
        locale === "en"
          ? "PUBLIC-MAP centralizes your Google Business Profile, Search Console, Analytics, and Google Ads in one dashboard, with audits and recommendations to help you grow. What would you like to know more about?"
          : "PUBLIC-MAP centralise votre Google Business Profile, Search Console, Analytics et Google Ads dans un seul tableau de bord, avec des audits et des recommandations pour vous aider à progresser. Que souhaitez-vous en savoir plus ?",
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  if (matchesAny(message, ["compte", "account", "connecter mon compte", "connect my account", "mot de passe", "password", "aide avec mon compte"])) {
    return {
      reply:
        locale === "en"
          ? "I can help with your account. Is this about connecting a Google integration, your organization settings, or something else?"
          : "Je peux vous aider avec votre compte. S'agit-il de connecter une intégration Google, des paramètres de votre organisation, ou autre chose ?",
      suggestions: DEFAULT_SUGGESTIONS,
    };
  }

  return { reply: unknownFallback(locale), action: { type: "show_lead_form" }, suggestions: DEFAULT_SUGGESTIONS };
}

export const mockAiProvider: AiProvider = { generateReply };
