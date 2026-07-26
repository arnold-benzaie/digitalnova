# Public Maps — App (Phase 0 scaffold)

The SaaS platform for managing Google Business Profile presence. Lives inside
the `digitalnova` repo alongside the static marketing site (repo root), but
is a fully separate Next.js project deployed to its own Vercel project and
subdomain (`app.public-map.com`). See `/Users/arnoldbenzaie/.claude/plans/merry-exploring-swing.md`
for the full architecture and phased roadmap.

## Phase 0 status

- ✅ Next.js 16 (App Router, TypeScript, Tailwind v4) scaffolded
- ✅ Brand design tokens bridged from the static site's `brand-theme-clean.css`
- ✅ Drizzle schema: `organizations`, `users`, `roles`, `memberships`, `audit_log`
- ✅ Clerk auth wired (middleware protects `/dashboard/*`), sign-in/sign-up pages
- ✅ Base app shell (sidebar + header) + placeholder dashboard
- ⬜ Real Postgres instance provisioned (Neon or Supabase — **you need to create
  this account**, it cannot be provisioned on your behalf without credentials)
- ⬜ Real Clerk application created (**you need to create this account** at
  clerk.com — free tier is fine to start)
- ⬜ Second Vercel project + `app.public-map.com` subdomain wired
- ⬜ Google Business Profile API access request filed (external, non-engineering
  timeline — start this in parallel, see plan risk #1)

## Local setup

```bash
cd app
npm install
cp .env.example .env.local
# fill in DATABASE_URL and the Clerk keys in .env.local, then:
npm run db:push   # creates the tables in your Postgres instance
npm run dev       # http://localhost:3000
```

Without `DATABASE_URL` and Clerk keys set, `npm run build` and `npm run lint`
still succeed (no hard dependency at build time), but `npm run dev` will show
Clerk's "missing publishable key" error on the auth pages until you add real
keys — that's expected until you've created the two accounts below.

## Accounts you need to create (Claude cannot create these for you)

1. **Database** — [neon.tech](https://neon.tech) or [supabase.com](https://supabase.com),
   free tier. Copy the Postgres connection string into `DATABASE_URL`.
2. **Clerk** — [clerk.com](https://clerk.com), free tier, "Next.js" quickstart.
   Copy the publishable + secret keys into `.env.local`.
3. **Anthropic** — an API key for `ANTHROPIC_API_KEY` (used by the AI audit
   engine and welcome assistant starting Phase 1).

Once you have these, tell me and I'll wire up the environment variables +
verify the whole flow end-to-end.

## Vercel: second project setup (manual — a few clicks, ~2 minutes)

The `deploy_to_vercel` tool available to Claude deploys "the current
project" with no way to target a specific subdirectory or set a custom
domain, so creating this second project safely needs to be done by you in
the dashboard rather than guessed at automatically:

1. [vercel.com/new](https://vercel.com/new) → **Import** the same
   `arnold-benzaie/digitalnova` GitHub repo again (yes, a second time — this
   creates a second, independent Vercel project from the same repo).
2. In the import screen, expand **Root Directory** and set it to `app`.
   Framework preset should auto-detect as Next.js.
3. Add the environment variables from `.env.local` (same names) in the
   project's **Settings → Environment Variables** — `DATABASE_URL`,
   `NEXT_PUBLIC_CLERK_PUBLISHABLE_KEY`, `CLERK_SECRET_KEY`,
   `ANTHROPIC_API_KEY` at minimum for Phase 0/1.
4. Deploy. Once it succeeds, go to **Settings → Domains** and add
   `app.public-map.com`, then add the CNAME record it gives you at your DNS
   provider (same place `public-map.com`'s DNS is already managed).
5. Optional but recommended: on **both** Vercel projects (the existing
   static-site one and this new one), set an **Ignored Build Step** so a
   push touching only `app/` doesn't rebuild the static site and vice versa
   — `Settings → Git → Ignored Build Step`, command:
   `git diff --quiet HEAD^ HEAD -- app` for the app project (rebuild only
   when `app/` changed), and the static site project's should rebuild only
   when something *outside* `app/` changed.

Tell me once this is done (or paste the project name/ID) and I can verify
the deployment the same way I verified the marketing site's — checking
`get_deployment`/`list_deployments` and curling the live subdomain.

## PUBLIC-MAP Audit — separate database, separate deploy steps

The `/admin/audit/*` module (Google Business Profile audits) runs against
its **own, isolated Supabase project** — deliberately never the same
database as the rest of this app (see `db/audit-schema.ts` header comment
and `db/guard-main-production.ts`). It has its own env vars
(`AUDIT_DATABASE_URL`, `NEXT_PUBLIC_AUDIT_SUPABASE_URL`,
`NEXT_PUBLIC_AUDIT_SUPABASE_ANON_KEY`, `AUDIT_SUPABASE_SERVICE_ROLE_KEY` —
see `.env.example`) and its own migration/setup sequence, which does
**not** happen automatically:

```bash
npm run audit:db:migrate              # applies db/audit-migrations/*.sql (schema only)
npm run audit:db:post-migrate-setup   # seeds audit_staff_roles + applies RLS — REQUIRED, not automatic
```

Both steps in `post-migrate-setup` are idempotent — safe to re-run after
every future migration, not just the first one. Skipping the second command
after a fresh migration leaves the project with **zero usable staff roles**
and **no RLS policies** (every table readable via the Data API by anyone
holding the anon key) — this actually happened once mid-session; see the
comments in `db/audit-migrations/rls-policies.sql` and
`scripts/audit-db-seed-roles.mjs` for the full story.

## Universal integrations and outbound webhooks

External automation tools, CRMs and partner applications share one generic
integration model. Human sessions remain on Clerk; future machine-to-machine
API keys are independent, high-entropy values whose plaintext is shown once
and whose HMAC-SHA256 hash is the only value persisted. The closed initial
scope catalog is defined in `lib/integrations/governance.ts`; no public
`/api/v1` route is enabled yet.

Webhook URLs and per-endpoint secrets are encrypted at rest with AES-256-GCM.
Configure the server-only `INTEGRATION_API_KEY_PEPPER` and a base64-encoded
32-byte `INTEGRATION_SECRET_ENCRYPTION_KEY` locally and in each deployment
environment before creating endpoints. Never prefix either variable with
`NEXT_PUBLIC_`, commit its value or reuse one as the other.

`user.pending.created` is the first outbox event. The user, internal
`user.pending_approval` notification and event are created atomically; its
stable event id is the notification UUID. HTTP delivery happens only in the
separate `/api/cron/integration-webhooks` worker. Each delivery signs
`timestamp + "." + rawBody` with the endpoint's own HMAC-SHA256 secret and
includes `X-Public-Map-Event-Id`, `X-Public-Map-Event-Type`,
`X-Public-Map-Timestamp` and `X-Public-Map-Signature`. Receivers must validate
the exact raw body, reject stale timestamps and deduplicate event ids.

The existing `N8N_WEBHOOK_URL`, `N8N_OUTBOUND_SECRET`, `N8N_INBOUND_SECRET`,
`/api/webhooks/n8n` and legacy dispatchers remain temporary compatibility
surfaces. They are not the foundation of the new multi-endpoint pipeline.

Before granting the first real admin, invite them from **Équipe** inside
the audit module (`/admin/audit/equipe`) — there is no other in-app way to
bootstrap the first account; it must be an email that will sign in via
Clerk after being invited.
