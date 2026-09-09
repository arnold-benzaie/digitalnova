/**
 * RADAR INTELLIGENCE V1 — Slice 1 — architectural domain separation.
 *
 * A future "connect X" feature falls into exactly ONE of three domains,
 * and they must never be conflated in code:
 *
 *   INTELLIGENCE_PROVIDER  — reasons over context, returns ADVISORY text.
 *                            (OpenAI, Anthropic, Gemini, DeepSeek, Kimi, local)
 *   DATA_SOURCE            — reads external business facts INTO the app.
 *                            (Google Business Profile, Search Console,
 *                             Analytics, Google Ads, Maps)
 *   ACTION_CONNECTOR       — performs an external side effect on a user's
 *                            explicit instruction. (Gmail, telephony, n8n,
 *                             external CRM)
 *
 * OpenAI is not Google Ads. Claude is not Gmail. Gemini is not n8n. The
 * intelligence gateway (this module) handles ONLY the first domain; the
 * other two get their own contracts in their own slices and never register
 * with the ProviderRegistry. This file is a type + constant boundary only
 * — no implementation, no connection.
 */

export const INTEGRATION_DOMAINS = ["INTELLIGENCE_PROVIDER", "DATA_SOURCE", "ACTION_CONNECTOR"] as const;
export type IntegrationDomain = (typeof INTEGRATION_DOMAINS)[number];

export const INTEGRATION_CONNECTION_STATES = ["DISCONNECTED", "CONNECTED", "DEGRADED", "DISABLED"] as const;
export type IntegrationConnectionState = (typeof INTEGRATION_CONNECTION_STATES)[number];

/** Minimal descriptor a future domain-specific contract would extend. */
export type BusinessIntegrationDescriptor = {
  id: string;
  domain: IntegrationDomain;
  displayName: string;
  connection: IntegrationConnectionState;
};

/** DOCUMENTATION ONLY — none of these is wired in Slice 1. They exist so a
 * reviewer can see which future connector belongs to which domain. */
export const KNOWN_DATA_SOURCES = [
  "google-business-profile",
  "google-search-console",
  "google-analytics",
  "google-ads",
  "google-maps",
] as const;

export const KNOWN_ACTION_CONNECTORS = ["gmail", "telephony", "n8n", "external-crm"] as const;

/** Guard: an id destined for the ProviderRegistry must be an intelligence
 * provider, never a data source / action connector. */
export function assertIntelligenceDomain(domain: IntegrationDomain): void {
  if (domain !== "INTELLIGENCE_PROVIDER") {
    throw new Error(`the intelligence registry accepts only INTELLIGENCE_PROVIDER integrations, got ${domain}`);
  }
}
