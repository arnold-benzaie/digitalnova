# RBAC bootstrap / migration procedure (PUBLIC-MAP internal workforce)

> **THIS TOOLING DOES NOT AUTHORIZE PRODUCTION EXECUTION.**
> The scripts below are built and tested against **disposable local
> PostgreSQL only**. Applying migration `0034` or writing any
> OWNER/ADMIN row to the protected production database is a **separate,
> separately-authorized slice** (`RBAC-BOOTSTRAP-EXEC`). Nothing here is
> a go-ahead.

## What this slice delivers

| File | Purpose |
|---|---|
| `scripts/db-migrate.mjs` | Reviewed main-DB migrator — replays `db/migrations/` via **drizzle-orm `migrate()`** (NOT `drizzle-kit push`, which would not run `0034`'s hand-appended `staff_roles` seed). Inspection by default; real apply is triple-guarded. |
| `scripts/bootstrap-first-staff-owner.mjs` | Reviewed first OWNER/ADMIN bootstrap — creates exactly one `OWNER` `staff_members` row plus one `ADMIN` row per explicitly-approved current active internal admin. Dry-run by default; one transaction; idempotent; fail-closed. |
| `scripts/lib/protected-db-target.mjs` | Shared positive DB-target classifier (production vs disposable vs refused). |
| `scripts/rbac-bootstrap-manifest.example.json` | Manifest **template** — no real identities. |

Neither script picks the OWNER. Migration `0034` never picks the OWNER.
The OWNER comes only from a human-approved manifest, confirmed by UUID.

## Migration mechanism

`migrate()` (drizzle-orm/node-postgres) replays every committed migration
file, statement-by-statement, **inside one Postgres transaction**
(drizzle-orm 0.45.2, `pg-core` dialect). Consequences:

- A failure at any statement **rolls back the whole run atomically** — no
  partial `staff_*` schema is left behind.
- A migration already recorded in `__drizzle_migrations` is **skipped** —
  re-running is a safe no-op.
- The `staff_roles` seed (`INSERT ... ON CONFLICT (name) DO NOTHING`) is
  idempotent regardless.

`drizzle-kit push` is **not** used here — it diffs schema only and would
not execute the seed.

## Positive production target guard (`--apply` real run)

`scripts/lib/protected-db-target.mjs` classifies a target as
`PRODUCTION-MAIN` **only when ALL THREE** hold:

1. `looksLikeMainProduction(connectionString) === true`
   (`db/guard-main-production.ts` — matches the known main-production
   project ref; an identifier, not a secret).
2. `current_database()` (read live) **=== the operator-supplied
   `--expected-db` / `manifest.expectedDbName`** — never guessed.
3. env `RBAC_BOOTSTRAP_TARGET === "production-main"`.

Anything else is `REFUSED`. Deliberately **not** "non-local ⇒ production".

Disposable-container runs use a separate path that a production URL can
never reach: env `RBAC_MIG_TEST_MODE=1` **and** a `127.0.0.1` host
**and** no production signature.

## Required future inputs (from the operator, before any protected write)

1. **Approved initial OWNER** — a `users.id` UUID, or an email that the
   dry-run resolves to exactly one ACTIVE `admin` member of the internal
   workspace, whose printed UUID the operator then passes to
   `--confirm-owner-id`.
2. **Approved additional ADMIN set** — the `users.id` UUIDs (or emails) of
   every *other* current legitimate internal admin who must keep
   `lib/actions/users.ts` access. Empty is allowed.
3. **Expected production `current_database()` name** — not recorded in
   this repo; supplied as `manifest.expectedDbName` / `--expected-db`.
4. **Expected internal workspace id** (optional) —
   `organizations.id` where `is_internal = true`.
5. **A verified pre-apply snapshot / backup** of the protected DB.
6. **Explicit authorization** to run `--apply` on the protected DB.

No secrets are ever required or accepted by these tools (never
`DATABASE_URL`, never tokens on the command line).

## Local (disposable) validation — the only thing this slice runs

```
# unit (no DB, no Docker):
npx tsx --test scripts/db-migrate.test.mjs scripts/bootstrap-first-staff-owner.test.mjs

# integration (needs Docker; creates + destroys its own postgres:16-alpine):
npx tsx --test scripts/rbac-mig-tooling.integration.test.mjs
```

## Future execution order (each its own authorized slice)

1. **RBAC-MIG-TOOLING** *(this slice)* — build + locally validate the tools. No protected DB contact.
2. **RBAC-BOOTSTRAP-EXEC** *(separate authorization)* — snapshot → `scripts/db-migrate.mjs --apply` → verify schema + seed → operator OWNER/ADMIN manifest → `scripts/bootstrap-first-staff-owner.mjs --apply` → verify memberships. No code change.
3. **RBAC-RUNTIME-1A** *(separate authorization)* — implement `requireStaffPermission` and wire the first `users.ts` enforcement point, only after the activation-readiness gate is green.

## Rollback posture

- **Code**: each future `users.ts` call site reverts to `requireAdminSession()` in one line.
- **Data**: set bootstrapped `staff_members` rows to `status = 'OFFBOARDING'` or delete them — reversible, no schema change.
- **Never** `DROP` the `staff_*` tables as rollback (migration `0034` is additive).
- Bootstrap writes are reversible independently of the migration.
