/**
 * Phase 2 (real LLM): the closed set of suggestion ids the widget knows
 * how to render — every id here has a FR/EN label in
 * app/lib/i18n/dictionaries/chat.ts and chat-widget-embed.js's own
 * PM_CHAT_STRINGS, and (for the site surface) a matching branch/leaf in
 * lib/chat/ai-mock-provider.ts. Extracted into its own file so both the
 * mock provider's implicit id usage and the real OpenAI provider (which
 * needs this as a hard `enum` constraint on the model's structured
 * output, never a free-form string) share one source of truth instead
 * of two independently-maintained lists drifting apart.
 *
 * `description` is server-side only — used to tell the model what each
 * id represents when choosing suggestions, never sent to the browser.
 */
export type SuggestionCatalogEntry = { id: string; description: string };

export const SUGGESTION_CATALOG: SuggestionCatalogEntry[] = [
  // Compact initial-screen chips
  { id: "visibility", description: "Grow overall online visibility (GBP + SEO + Ads combined)" },
  { id: "lead_generation", description: "Get more customers / leads in general" },
  { id: "automation", description: "AI automation for the business in general" },
  { id: "website", description: "Create or improve a website" },
  { id: "gbp", description: "Google Business Profile optimization in general" },
  { id: "google_ads", description: "Google Ads campaigns in general" },
  { id: "seo", description: "SEO in general" },
  { id: "quote", description: "Get a quote — triggers the lead form" },
  { id: "automation_setup", description: "Set up business automations (same as automation)" },
  { id: "performance_review", description: "Analyze digital performance across channels" },
  { id: "reviews", description: "Get more customer reviews" },
  { id: "browse_services", description: "See PUBLIC-MAP's main service categories" },
  { id: "human", description: "Talk to a human PUBLIC-MAP advisor — triggers the lead form" },
  // Google Business Profile sub-topics
  { id: "gbp_audit", description: "Google Business Profile audit" },
  { id: "gbp_info", description: "Optimize Google Business Profile listing info" },
  { id: "seo_local", description: "Local SEO" },
  { id: "gbp_reviews", description: "Managing Google reviews" },
  { id: "gbp_posts", description: "Google Business Profile posts" },
  { id: "gbp_photos", description: "Google Business Profile photos" },
  { id: "gbp_performance", description: "Google Business Profile performance tracking" },
  // Google Ads sub-topics
  { id: "ads_new_campaign", description: "Create a new Google Ads campaign" },
  { id: "ads_audit", description: "Audit an existing Google Ads campaign" },
  { id: "ads_search", description: "Google Ads Search campaigns" },
  { id: "ads_pmax", description: "Google Ads Performance Max" },
  { id: "ads_display", description: "Google Ads Display campaigns" },
  { id: "ads_conversion_tracking", description: "Google Ads conversion tracking" },
  { id: "ads_reports", description: "Google Ads reporting" },
  // SEO sub-topics
  { id: "seo_technical", description: "Technical SEO" },
  { id: "seo_keywords", description: "Keyword research" },
  { id: "seo_pages", description: "On-page SEO optimization" },
  { id: "seo_search_console", description: "Google Search Console" },
  { id: "seo_audit", description: "Full SEO audit" },
  // Website sub-topics
  { id: "website_showcase", description: "Showcase / brochure website" },
  { id: "website_booking", description: "Website with online booking" },
  { id: "website_ecommerce", description: "E-commerce website" },
  { id: "website_landing", description: "Landing page" },
  { id: "website_custom", description: "Custom platform" },
  // Automation sub-topics
  { id: "automation_leads", description: "Automate lead qualification/routing" },
  { id: "automation_support", description: "Automate customer support replies" },
  { id: "automation_emails", description: "Automate follow-up emails" },
  { id: "automation_whatsapp", description: "Automate WhatsApp replies" },
  { id: "automation_crm", description: "Automate/connect the CRM" },
  { id: "automation_integrations", description: "n8n / webhooks / API integrations" },
  { id: "automation_examples", description: "Concrete automation examples" },
  // Lead-generation sub-topics
  { id: "leadgen_forms", description: "Smart lead-capture forms" },
  { id: "leadgen_qualification", description: "Automatic lead qualification" },
];

export const SUGGESTION_IDS = SUGGESTION_CATALOG.map((entry) => entry.id);

export function isKnownSuggestionId(id: string): boolean {
  return SUGGESTION_IDS.includes(id);
}
