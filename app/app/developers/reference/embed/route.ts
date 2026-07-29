import { ApiReference } from "@scalar/nextjs-api-reference";

/**
 * Raw Scalar-rendered reference UI (standalone HTML, not a React page) —
 * embedded via an <iframe> from both /developers/reference/page.tsx
 * (public) and /developers/console/playground/page.tsx (Stage 4,
 * authenticated Playground) — the SAME embed serves both, never
 * duplicated. Also directly linkable full-screen. Kept as its own
 * route.ts (rather than inside a page) because ApiReference() returns a
 * plain Response, which only a route handler can serve — Next.js layouts
 * don't wrap route.ts handlers, so this deliberately has no PUBLIC-MAP
 * chrome around it; the pages that embed it are what provide that.
 *
 * Renders client-side from a CDN-hosted bundle (jsDelivr, Scalar's
 * default) — the only place in this app that loads UI code from a third
 * party at runtime. Documented as a known trade-off in the Stage 1
 * report, not hidden.
 *
 * `authentication.preferredSecurityScheme` only pre-selects which auth
 * field Scalar's own "Test Request" panel shows by default (matching our
 * real scheme name from openapi.yaml) — it carries NO token value. A
 * developer types their API key directly into Scalar's client-side-only
 * form; the key is never sent to this server, never logged, and never
 * persisted anywhere — see the Stage 4 report's "Injection sécurisée des
 * clés API" section for why that design was chosen over any server-side
 * key-injection mechanism.
 */
export const GET = ApiReference({
  url: "/developers/openapi.yaml",
  pageTitle: "PUBLIC-MAP API Reference",
  theme: "default",
  showSidebar: true,
  authentication: {
    preferredSecurityScheme: "bearerAuth",
  },
});
