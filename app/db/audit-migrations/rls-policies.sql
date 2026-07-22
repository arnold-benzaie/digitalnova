-- PUBLIC-MAP Audit — Row Level Security policies
-- ═══════════════════════════════════════════════════════════════════════
-- NOT applied automatically by drizzle-kit (RLS policies aren't part of
-- the Drizzle schema). Apply manually via the Supabase SQL editor, AFTER
-- running the audit:db:migrate script once (tables must exist first).
--
-- HONEST SCOPE — read this before assuming RLS "protects prospects from
-- each other" on its own:
--
-- This app authenticates staff via Clerk, not Supabase Auth. There is no
-- `auth.uid()` / JWT claim Postgres can key policies off for a logged-in
-- agent — the real authorization decision ("is this Clerk user an admin,
-- supervisor or staff member, and are they allowed to see THIS audit") is
-- made in Next.js server code (lib/gbp-audit/session.ts), which then
-- queries Postgres using a single application-level connection role.
--
-- What RLS DOES do here, and it's a real, worthwhile layer:
--   Defense in depth against the Supabase Data API (PostgREST). If the
--   anon/service_role keys ever leak, or the Data API is accidentally left
--   enabled and someone finds the project URL, RLS with NO policy granted
--   to `anon`/`authenticated` means every single query from that surface
--   returns zero rows — full deny by default. Without this, Supabase's
--   Data API would otherwise expose every table to anyone with the anon
--   key, which is often bundled into client code elsewhere. This is why
--   NEXT_PUBLIC_AUDIT_SUPABASE_ANON_KEY exists but is never actually
--   queried against by this codebase (see lib/gbp-audit/storage.ts).
--
-- What RLS does NOT do here:
--   Per-agent row filtering ("agent A can't see agent B's audits"). Today
--   every audit is agency-shared (any staff member can see any audit —
--   same model as the main app's CRM). If per-agent restriction is wanted
--   later, it needs to be enforced in lib/gbp-audit/session.ts + the page
--   queries (WHERE assigned_agent_id = session.userId), not here.
--
--   Prospect/client isolation for the token portal. A prospect never
--   authenticates with Supabase at all — their only credential is the
--   token in gbp_report_access_links, validated server-side in the Next.js
--   route handler (using the same privileged audit_app role). The browser
--   never talks to Supabase directly for report data, so there's no
--   Supabase-level "prospect can only see their own report" policy to
--   write — the isolation is that the token lookup is a WHERE clause in
--   trusted server code, not a client-side query at all.
--
-- ═══════════════════════════════════════════════════════════════════════

-- STEP 1 (manual, one-time) — create a dedicated, non-superuser role for
-- the application connection. Do NOT use the default `postgres` role for
-- AUDIT_DATABASE_URL: `postgres` bypasses RLS entirely (superuser), which
-- would make every policy below a no-op.
--
--   CREATE ROLE audit_app WITH LOGIN PASSWORD '<generate a strong password>';
--   GRANT ALL ON ALL TABLES IN SCHEMA public TO audit_app;
--   GRANT ALL ON ALL SEQUENCES IN SCHEMA public TO audit_app;
--   ALTER DEFAULT PRIVILEGES IN SCHEMA public GRANT ALL ON TABLES TO audit_app;
--
-- Then build AUDIT_DATABASE_URL using audit_app's credentials instead of
-- postgres's, e.g.:
--   postgresql://audit_app:<password>@<pooler-host>:5432/postgres?sslmode=require
--
-- (Supabase's connection pooler works with any role, not just `postgres` —
-- use the same host/port shown in Project Settings → Database, just swap
-- the username/password.)

-- STEP 2 — enable RLS + explicit "allow only audit_app" policy on EVERY
-- table in the schema, unconditionally (no whitelist). An earlier version
-- of this file hardcoded a table name list here; it went stale the moment
-- a new table (audit_staff_invitations, audit_rate_limit_hits) was added
-- later and silently ran with zero RLS protection until this was caught
-- and fixed. Iterating pg_tables directly means this file self-updates as
-- the schema grows — re-run it any time after a migration, safely (both
-- statements below are idempotent: ENABLE ROW LEVEL SECURITY is a no-op if
-- already enabled, and DROP POLICY IF EXISTS clears the way for a clean
-- CREATE POLICY even on a second run).

DO $$
DECLARE
  t text;
BEGIN
  FOR t IN
    SELECT tablename FROM pg_tables WHERE schemaname = 'public'
  LOOP
    EXECUTE format('ALTER TABLE public.%I ENABLE ROW LEVEL SECURITY;', t);
    EXECUTE format('DROP POLICY IF EXISTS %I ON public.%I;', t || '_app_only', t);
    -- Deny-by-default is implicit once RLS is enabled with no policy for a
    -- given role. This policy is the ONLY grant: full access, but only for
    -- the audit_app role created in step 1. anon/authenticated (Supabase's
    -- PostgREST roles) get nothing — no policy matches them, so every
    -- request from the Data API returns an empty result set.
    EXECUTE format(
      'CREATE POLICY %I ON public.%I FOR ALL TO audit_app USING (true) WITH CHECK (true);',
      t || '_app_only', t
    );
  END LOOP;
END $$;

-- STEP 3 (verification) — confirm no policy grants anything to anon/authenticated:
--   SELECT tablename, policyname, roles FROM pg_policies WHERE schemaname = 'public';
-- Every row's `roles` column should show only {audit_app}, never {anon} or {authenticated}.
