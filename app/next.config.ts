import type { NextConfig } from "next";
import path from "node:path";

// Clerk's Frontend API is proxied through a custom domain in production
// (see NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY — decodes to
// clerk.public-map.com), but `npm run dev` / the e2e harness deliberately
// use Clerk's separate Development instance instead (see e2e/README.md —
// Production Clerk keys refuse browser auth from localhost by design), on
// its default *.clerk.accounts.dev domain. Both need a CSP allowance, but
// only in their own environment — production must never widen to the dev
// wildcard.
const isDev = process.env.NODE_ENV !== "production";
const CLERK_FRONTEND_API = "https://clerk.public-map.com";
const CLERK_DEV_FRONTEND_API = "https://*.clerk.accounts.dev";
const clerkSources = isDev ? `${CLERK_FRONTEND_API} ${CLERK_DEV_FRONTEND_API}` : CLERK_FRONTEND_API;
// Clerk loads Cloudflare Turnstile (bot-protection challenge) on sign-up
// whenever it decides a request needs one — not on every sign-up, which is
// why this was missed by the original security audit's real-browser CSP
// checks (they didn't happen to trigger a challenge). Without this origin
// in script-src/frame-src, Turnstile's script is blocked outright and
// Clerk surfaces that as a generic "security validation failed" error,
// silently breaking sign-up for whichever request Clerk decides to
// challenge. Script + frame only — Turnstile doesn't need connect-src.
const TURNSTILE_SOURCE = "https://challenges.cloudflare.com";

// Baseline CSP for the whole app. Deliberately does NOT cover
// /developers/reference/embed (see the dedicated, more permissive rule
// below) — that route is the one deliberate exception, documented in its
// own file, that loads a third-party CDN bundle (Scalar via jsDelivr).
//
// script-src carries 'unsafe-inline': verified with a real headless
// browser (Playwright) against every page type in this app that Next.js
// itself injects inline bootstrap/hydration scripts on every route, not
// just this app's own code — the framework's documented alternative is a
// per-request nonce via Proxy, but that requires opting every single page
// into forced dynamic rendering (no static optimization, no CDN caching,
// see node_modules/next/dist/docs/01-app/02-guides/content-security-policy.md),
// which is a real architecture/cost change out of scope for a security
// hardening pass. This app has zero dangerouslySetInnerHTML, zero eval,
// and zero HTML/markdown-from-user-input rendering anywhere (verified),
// so the realistic marginal risk 'unsafe-inline' adds here is low — CSP
// still meaningfully restricts which origins can load scripts/frames/
// connect/etc. Revisit with nonces if either of those two facts changes.
//
// 'unsafe-eval' is dev-only, same rationale Next's own docs give: React
// uses eval in development to reconstruct server-side error stacks in the
// browser; neither React nor Next.js use eval in production.
const BASE_CSP = [
  "default-src 'self'",
  `script-src 'self' 'unsafe-inline' ${clerkSources} ${TURNSTILE_SOURCE}${isDev ? " 'unsafe-eval'" : ""}`,
  "style-src 'self' 'unsafe-inline'",
  `img-src 'self' data: https://img.clerk.com${isDev ? ` ${CLERK_DEV_FRONTEND_API}` : ""}`,
  "font-src 'self' data:",
  `connect-src 'self' ${clerkSources} https://api.clerk.com`,
  `frame-src 'self' ${clerkSources} ${TURNSTILE_SOURCE}`,
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "form-action 'self'",
  "frame-ancestors 'self'",
  // The local Next server is intentionally HTTP. Keeping this production
  // browser directive in development upgrades RSC refreshes to HTTPS and
  // breaks mutations after otherwise successful Server Actions.
  ...(isDev ? [] : ["upgrade-insecure-requests"]),
].join("; ");

// /developers/reference/embed (see that route's own docstring) is the
// one place in this app that intentionally loads UI code from a third
// party at runtime — Scalar's standalone bundle from jsDelivr, which in
// turn loads its own fonts from fonts.scalar.com and calls
// api.scalar.com for its registry search feature (both confirmed via the
// same real-browser check, not guessed). Scoped to exactly this path so
// the relaxation never leaks to the rest of the app.
const SCALAR_EMBED_CSP = [
  "default-src 'self'",
  "script-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "style-src 'self' https://cdn.jsdelivr.net 'unsafe-inline'",
  "img-src 'self' https://cdn.jsdelivr.net data: https:",
  "font-src 'self' https://cdn.jsdelivr.net https://fonts.scalar.com data:",
  "connect-src 'self' https://cdn.jsdelivr.net https://api.scalar.com",
  "worker-src 'self' blob:",
  "object-src 'none'",
  "base-uri 'self'",
  "frame-ancestors 'self'",
].join("; ");

const SECURITY_HEADERS = [
  { key: "X-Content-Type-Options", value: "nosniff" },
  { key: "X-Frame-Options", value: "SAMEORIGIN" },
  { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
  { key: "Permissions-Policy", value: "camera=(), microphone=(), geolocation=(), interest-cohort=()" },
  { key: "Strict-Transport-Security", value: "max-age=63072000; includeSubDomains; preload" },
];

const nextConfig: NextConfig = {
  // Pin the workspace root to this project — without this, Next infers it
  // from the nearest lockfile up the directory tree, which in this repo
  // layout picks up an unrelated lockfile several levels above `app/`.
  outputFileTracingRoot: path.join(__dirname),
  // Documents are stored as base64 in Postgres (no object storage
  // configured yet — see db/schema.ts `documents`), so uploads go through
  // a Server Action; raise the default 1MB body limit to fit them.
  experimental: {
    serverActions: {
      bodySizeLimit: "5mb",
    },
  },
  // Don't advertise the framework to every response.
  poweredByHeader: false,
  async headers() {
    return [
      {
        source: "/((?!developers/reference/embed).*)",
        headers: [...SECURITY_HEADERS, { key: "Content-Security-Policy", value: BASE_CSP }],
      },
      {
        source: "/developers/reference/embed",
        headers: [...SECURITY_HEADERS, { key: "Content-Security-Policy", value: SCALAR_EMBED_CSP }],
      },
    ];
  },
};

export default nextConfig;
