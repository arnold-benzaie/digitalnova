import "server-only";

/**
 * Closed allow-list. Adding a scope is a reviewed contract change.
 *
 * The first 6 entries are enforced today by a real `/api/v1/*` route
 * (each route calls `authenticateApiRequest(request, { requiredScope })`
 * — see lib/api-v1/*.ts). Every entry below the "reserved" marker is
 * accepted by key creation/rotation (so a developer can select it and it
 * is stored) but is NOT YET CHECKED by any route, because the
 * corresponding `/api/v1` surface (quotes, invoices, CRM, OAuth,
 * administration) does not exist yet — selecting one of these grants no
 * additional access today. Documented here rather than silently omitted,
 * matching this project's convention of marking not-yet-shipped things
 * explicitly (see lib/developer-portal/nav.ts's `status: "soon"`) instead
 * of pretending they don't exist. Move an entry above the marker only in
 * the same change that adds its real enforcement point.
 */
export const INTEGRATION_SCOPES = [
  // Enforced today.
  "audits:read",
  "reports:read",
  "clients:read",
  "clients:update",
  "tasks:create",
  "interactions:create",

  // Reserved — accepted, stored, displayed; not yet enforced by any route.
  "audits:create",
  "audits:update",
  "audits:delete",
  "reports:download",
  "reports:generate",
  "clients:create",
  "clients:delete",
  "quotes:read",
  "quotes:create",
  "quotes:update",
  "quotes:delete",
  "invoices:read",
  "invoices:create",
  "invoices:refund",
  "crm:read",
  "crm:write",
  "tasks:read",
  "tasks:complete",
  "webhooks:read",
  "webhooks:write",
  "oauth:read",
  "oauth:write",
  "administration:read",
  "administration:write",
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
