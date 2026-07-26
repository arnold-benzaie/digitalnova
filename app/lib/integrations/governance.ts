import "server-only";

/** Closed allow-list. Adding a scope is a reviewed contract change. */
export const INTEGRATION_SCOPES = [
  "audits:read",
  "reports:read",
  "clients:read",
  "clients:update",
  "tasks:create",
  "interactions:create",
] as const;

export type IntegrationScope = (typeof INTEGRATION_SCOPES)[number];

export const INTEGRATION_EVENT_CATALOG = {
  "user.pending.created": {
    version: 1,
    allowedDataFields: ["userId", "displayName", "adminPath"] as const,
    containsPersonalData: true,
  },
} as const;

export type IntegrationEventType = keyof typeof INTEGRATION_EVENT_CATALOG;

export function isKnownIntegrationScope(value: string): value is IntegrationScope {
  return (INTEGRATION_SCOPES as readonly string[]).includes(value);
}

export function isSupportedEventContract(type: string, version: number): type is IntegrationEventType {
  return type in INTEGRATION_EVENT_CATALOG && INTEGRATION_EVENT_CATALOG[type as IntegrationEventType].version === version;
}
