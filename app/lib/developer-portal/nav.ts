/**
 * Navigation/content config for the `/developers` portal — deliberately
 * framework-agnostic (no Next.js imports, no JSX) so this module can move
 * as-is if the portal is ever migrated to a separate `developers.public-map.com`
 * project (see the architecture plan's "portability" principle). Only
 * `app/developers/**` and `components/developer-portal/**` are expected to
 * change in that migration; this file isn't one of them.
 *
 * Every top-level PUBLIC-MAP-facing section of the eventual developer
 * ecosystem (guides, Explorer, Console, SDKs, collections, webhooks,
 * templates, marketplace) has an entry here from Stage 1 onward — most
 * marked `status: "soon"` with no working route yet. Shipping a later
 * stage means flipping one entry to `status: "available"` and pointing
 * `href` at the real route; it never means re-deriving the list of
 * sections from scratch.
 */

export type SectionStatus = "available" | "soon";

export type PortalNavItem = {
  key: string;
  label: string;
  href: string;
  status: SectionStatus;
};

export type PortalNavGroup = {
  key: string;
  label: string;
  items: PortalNavItem[];
};

/** Structural shape only (plain `string`s), matching either locale's
 * `dictionaries[locale].developers` — see components/app-sidebar-nav.tsx's
 * `NavDict` for the precedent this follows. */
type DevelopersDict = {
  header: { nav: { docs: string; reference: string; roadmap: string; security: string } };
  docsNav: {
    guidesGroup: string;
    guides: {
      quickstart: string; authentication: string; pagination: string; idempotency: string; rateLimits: string; errors: string; faq: string;
      sdkUsage: string; examples: string; webhooks: string;
    };
    resourcesGroup: string;
    resources: { sdk: string; collections: string; console: string; n8nTemplates: string; makeScenarios: string; airtableScripts: string; zapierApp: string };
    policiesGroup: string;
    policies: { versioning: string; changelog: string; oauth: string };
    designNotesGroup: string;
    designNotes: { eventCatalog: string };
    soonGroup: string;
    soon: { explorer: string; templates: string; marketplace: string };
  };
};

/** Top header nav — only ever the sections that exist as real pages
 * (Stage 1: docs, reference, roadmap, security). The Console link is
 * rendered separately by the header itself (always "soon" in Stage 1). */
export function getPortalHeaderNav(t: DevelopersDict): PortalNavItem[] {
  return [
    { key: "docs", label: t.header.nav.docs, href: "/developers/docs", status: "available" },
    { key: "reference", label: t.header.nav.reference, href: "/developers/reference", status: "available" },
    { key: "roadmap", label: t.header.nav.roadmap, href: "/developers/roadmap", status: "available" },
    { key: "security", label: t.header.nav.security, href: "/developers/security", status: "available" },
  ];
}

/** Sidebar shown alongside every /developers/docs/** page — lists every
 * guide that exists today AND every future section the portal is meant to
 * grow into, so the full scope of the ecosystem is always visible even
 * before each piece ships. */
export function getDocsNavGroups(t: DevelopersDict): PortalNavGroup[] {
  return [
    {
      key: "guides",
      label: t.docsNav.guidesGroup,
      items: [
        { key: "quickstart", label: t.docsNav.guides.quickstart, href: "/developers/docs/quickstart", status: "available" },
        { key: "authentication", label: t.docsNav.guides.authentication, href: "/developers/docs/authentication", status: "available" },
        { key: "pagination", label: t.docsNav.guides.pagination, href: "/developers/docs/pagination", status: "available" },
        { key: "idempotency", label: t.docsNav.guides.idempotency, href: "/developers/docs/idempotency", status: "available" },
        { key: "rate-limits", label: t.docsNav.guides.rateLimits, href: "/developers/docs/rate-limits", status: "available" },
        { key: "errors", label: t.docsNav.guides.errors, href: "/developers/docs/errors", status: "available" },
        { key: "faq", label: t.docsNav.guides.faq, href: "/developers/docs/faq", status: "available" },
        { key: "sdk-usage", label: t.docsNav.guides.sdkUsage, href: "/developers/docs/sdk-usage", status: "available" },
        { key: "examples", label: t.docsNav.guides.examples, href: "/developers/docs/examples", status: "available" },
        { key: "webhooks", label: t.docsNav.guides.webhooks, href: "/developers/docs/webhooks", status: "available" },
      ],
    },
    {
      key: "resources",
      label: t.docsNav.resourcesGroup,
      items: [
        { key: "sdk", label: t.docsNav.resources.sdk, href: "/developers/sdk", status: "available" },
        { key: "collections", label: t.docsNav.resources.collections, href: "/developers/collections", status: "available" },
        { key: "console", label: t.docsNav.resources.console, href: "/developers/console", status: "available" },
        { key: "n8n-templates", label: t.docsNav.resources.n8nTemplates, href: "/developers/templates/n8n", status: "available" },
        { key: "make-scenarios", label: t.docsNav.resources.makeScenarios, href: "/developers/templates/make", status: "available" },
        { key: "airtable-scripts", label: t.docsNav.resources.airtableScripts, href: "/developers/templates/airtable", status: "available" },
        { key: "zapier-app", label: t.docsNav.resources.zapierApp, href: "/developers/templates/zapier", status: "available" },
        // Ships in Stage 4 as the authenticated Console's Playground
        // (/developers/console/playground), not a standalone public
        // route — reuses docsNav.soon.explorer's label text (still
        // accurate: "API Explorer"), no dictionary key was renamed.
        { key: "explorer", label: t.docsNav.soon.explorer, href: "/developers/console/playground", status: "available" },
      ],
    },
    {
      key: "policies",
      label: t.docsNav.policiesGroup,
      items: [
        { key: "versioning", label: t.docsNav.policies.versioning, href: "/developers/docs/versioning", status: "available" },
        { key: "changelog", label: t.docsNav.policies.changelog, href: "/developers/docs/changelog", status: "available" },
        { key: "oauth", label: t.docsNav.policies.oauth, href: "/developers/docs/oauth", status: "available" },
      ],
    },
    {
      key: "design-notes",
      label: t.docsNav.designNotesGroup,
      items: [
        { key: "event-catalog", label: t.docsNav.designNotes.eventCatalog, href: "/developers/docs/event-catalog", status: "available" },
      ],
    },
    {
      key: "soon",
      label: t.docsNav.soonGroup,
      items: [
        // n8n, Make, Airtable, and Zapier (the four platforms this entry
        // used to represent collectively) have all shipped as their own
        // "available" entries in the resources group above — only the
        // marketplace listing itself remains unbuilt.
        { key: "marketplace", label: t.docsNav.soon.marketplace, href: "/developers/marketplace", status: "soon" },
      ],
    },
  ];
}
