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
