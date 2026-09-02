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
| `scripts/db-migrate.mjs` | Reviewed main-DB migrator — replays the selected `--migrations-folder` via **drizzle-orm `migrate()`** (NOT `drizzle-kit push`, which would not run hand-appended seed statements such as `0034`'s `staff_roles` seed). Inspection by default. A production `--apply` requires: a positively-identified target; a `--migrations-folder` that canonically resolves **inside `<repo>/db/`**; an operator `--expected-pending` set that must exactly equal the target's actual pending migrations; a reviewer-supplied `--expected-fingerprint` (SHA-256 of the folder, checked before connection **and** again immediately before `migrate()`); `--acknowledge-prefix-hash-drift` if any already-applied prefix row's hash differs; then read-only structural post-verification of every applied migration. |
| `scripts/bootstrap-first-staff-owner.mjs` | Reviewed first OWNER/ADMIN bootstrap — creates exactly one `OWNER` `staff_members` row plus one `ADMIN` row per explicitly-approved current active internal admin. Dry-run by default; one transaction; idempotent; fail-closed. |
| `scripts/lib/protected-db-target.mjs` | Shared positive DB-target classifier (production vs disposable vs refused). |
| `scripts/rbac-bootstrap-manifest.example.json` | Manifest **template** — no real identities. |

Neither script picks the OWNER. Migration `0034` never picks the OWNER.
The OWNER comes only from a human-approved manifest, confirmed by UUID.

## Migration mechanism

`migrate()` (drizzle-orm/node-postgres) replays every migration file **in
the selected `--migrations-folder`**, statement-by-statement, **inside one
Postgres transaction** (drizzle-orm 0.45.2, `pg-core` dialect).
Consequences:

- A failure at any statement **rolls back the whole run atomically** — no
  partial `staff_*` schema is left behind.
- A migration already recorded in `__drizzle_migrations` is **skipped** —
  re-running is a safe no-op.
- The `staff_roles` seed (`INSERT ... ON CONFLICT (name) DO NOTHING`) is
  idempotent regardless.

`drizzle-kit push` is **not** used here — it diffs schema only and would
not execute the seed.

## The migrations-folder boundary + `--expected-pending` are SECURITY controls

`migrate()` applies **every** journal entry whose `when` is greater than
the single latest `created_at` recorded in `drizzle.__drizzle_migrations`.
It cannot stop early, cannot skip, and does **not** verify that the
recorded rows form a clean prefix — it only compares against
`MAX(created_at)`. Two operator inputs constrain it:

1. **`--migrations-folder <path>`** — the *ceiling* of what can be applied.
   The folder's journal defines the last migration `migrate()` is even
   able to run. **Never point `--apply` at the current repo `HEAD`
   `db/migrations/` for a release that must stop before the newest
   migration.** For the CRM `0031–0033` repair the journal must end at
   `0033_reflective_wolf_cub`; `HEAD` today ends at `0034_aberrant_earthquake`
   (the RBAC migration), so a `HEAD` replay against a `0030`-era database
   would apply `0034` too. Use a reviewed, historically-pinned folder (the
   `db/migrations/` tree of the last commit whose journal ends at the last
   migration in scope) or a reviewed release artifact.

2. **`--expected-pending <tag1,tag2,...>`** — the operator's explicit,
   ordered statement of which migrations this window may apply. `db-migrate.mjs`
   refuses to mutate unless the target's **actual** pending set — the
   selected journal minus a *verified exact clean contiguous prefix* of
   `drizzle.__drizzle_migrations` (matched position-by-position on
   `created_at` = journal `when`) — is **byte-for-byte equal, in order**,
   to `--expected-pending`. Locally (before any connection) it also
   rejects an `--expected-pending` that is not the journal's trailing
   contiguous slice, that contains an unknown/duplicate tag, or that spans
   the whole journal.

3. **`--expected-fingerprint <sha256>`** (CRM-MIGRATOR-HARDENING-2,
   **mandatory for a production `--apply`**) — a **reviewer/operator-supplied**
   SHA-256 of the selected folder's content. It is **NOT self-derived** by
   the tool: `db-migrate.mjs` only *compares* it, byte-for-byte, to the
   folder's deterministic fingerprint — **before connecting**, and **again
   immediately before `migrate()`** (see the artifact re-check below).
   Missing (production), malformed, or mismatched → refuse before
   connection. Run inspection mode (`db-migrate.mjs --migrations-folder
   <path>`) to obtain the fingerprint out of band for review.

4. **Trusted folder boundary** — for a production `--apply` the
   `--migrations-folder` must **canonically resolve inside `<repo>/db/`**
   (real-path containment, so `..`, absolute paths, and symlinked
   directories cannot escape). A pinned repair artifact must be committed
   under `<repo>/db/` (e.g. `db/migrations-<pin>/`); `/tmp`, home-dir, and
   external folders are refused. Disposable (`RBAC_MIG_TEST_MODE=1`,
   `127.0.0.1`) runs are exempt and may use `mkdtemp`.

5. **`--acknowledge-prefix-hash-drift`** — for a production `--apply`, if
   any already-applied prefix row's recorded hash differs from the
   selected folder's `.sql` (the `created_at` prefix check still having
   passed), the tool prints the affected tags + abbreviated hashes in the
   mutation plan and then **refuses** unless this flag is also passed. The
   flag does **not** bypass any other gate (`created_at` prefix,
   `--expected-pending`, `--expected-fingerprint`, DB identity, the
   artifact re-check). Disposable runs are permissive.

Order of checks on `--apply`: **(1)** malformed-CLI refusal (a
value-flag present without its value fails loudly — never a silent
default); **(2)** initial local artifact validation (folder resolve +
journal structure + `--expected-pending` local validation +
`--expected-fingerprint` parse); **(3)** static pre-connection gate —
trusted-folder boundary (production) + `--expected-fingerprint` match +
`looksLikeMainProduction` + `--expected-db` + `--expected-pending` for a
production target; `127.0.0.1` + no production signature for a disposable
one — any failure means **zero connections**; **(4)** `BEGIN READ ONLY`
first read-only preflight (`current_database()` → `classifyTarget()` →
read `drizzle.__drizzle_migrations` → clean-prefix check → observed
pending) → `ROLLBACK`; **(5)** exact `observed == --expected-pending`
gate; **(6)** `MUTATION PLAN` (with prefix-hash-drift detail) +
prefix-hash-drift acknowledgement gate + typed `MIGRATE`; **(7)** second
read-only preflight (DB change-window recheck; abort on any drift);
**(8)** **artifact re-check** — re-read the journal + every `.sql`,
require the recomputed fingerprint `===` the initial one `===`
`--expected-fingerprint` and the journal identity (idx/tag/`when`)
unchanged; abort if anything moved during the prompt window; **(9)**
`migrate()` against the selected folder; **(10)** post-verify recorded
rows **plus** per-migration structural verifiers.

### Post-migration structural verification (CRM-MIGRATOR-HARDENING-2)

`postVerify` runs a small registry of **read-only** (SELECT / catalog
introspection only) verifiers keyed by migration tag, for every migration
in the applied set:

| tag | asserts (derived from the committed `.sql`) |
|---|---|
| `0031_stiff_leech` | `crm_quote_access_links` table + its 8 columns + `crm_quote_access_links_quote_id_idx` + `UNIQUE crm_quote_access_links_token_idx` + the FK to `crm_quotes` |
| `0032_cool_red_wolf` | `crm_clients.industry` / `do_not_contact` (NOT NULL DEFAULT false) / `do_not_contact_reason` + `crm_clients_industry_idx` |
| `0033_reflective_wolf_cub` | `interactions.direction` / `interactions.outcome` |
| `0034_aberrant_earthquake` | three `staff_*` tables + exact `staff_roles` seed (unchanged) |

A migration with **no registered verifier gets metadata verification only**
(recorded-row count + latest `created_at`); the tool does not invent
structural contracts for migrations it does not know. A structural failure
returns `verifyFailed=true, mutated=true` — the migration may already have
committed; **it is not reported as success**. A separate SELECT-only
verification of the running application is still recommended before
re-enabling traffic.

### Residual DB race (NOT eliminated — and not "fewer only")

There remains a residual race between the tool's **second read-only
preflight** (`ROLLBACK`) and drizzle's own internal
`select … order by created_at desc limit 1` at the start of `migrate()`.
A **different** connection writing to `drizzle.__drizzle_migrations` in
that window has two distinct effects:

1. **INSERT of a newer metadata row** → drizzle executes **fewer** pending
   migrations, or none. Post-verify's recorded-row-count check then fails
   (`verifyFailed`).
2. **DELETE / TRUNCATE / rewind of `drizzle.__drizzle_migrations`** →
   drizzle's `!lastDbMigration` branch makes it **ATTEMPT to replay
   earlier migrations from the selected journal — potentially the entire
   selected journal**, not just the authorised `--expected-pending` set.

For the **currently reviewed** populated PUBLIC-MAP schema and the
historical `0000..0033` migration set, that replay attempt re-issues
existing non-idempotent historical DDL (bare `CREATE TABLE` / `CREATE
INDEX`, no `IF NOT EXISTS`), so the drizzle `migrate()` transaction
**fails and rolls back atomically** and `run()` reports `migrationFailed`.
This reviewed scenario therefore does **not** establish an unauthorised
committed-SQL path — but the earlier "**can only cause fewer migrations to
run**" claim is **false**, and this atomic-rollback conclusion is
**specific to this schema + migration set** and does **not** generalise to
arbitrary future migration histories.

**The production migration procedure MUST provide an exclusive controlled
migration window** in which, for the duration of the migration, no other
process or operator has permission to, against the target database:

- `INSERT` / `UPDATE` / `DELETE` / `TRUNCATE` migration metadata
  (`drizzle.__drizzle_migrations`);
- execute schema DDL;
- run another migration process.

This procedural exclusion **removes the concurrent actor**; it does **not**
cryptographically eliminate the race, and the residual race is **not fully
eliminated**. Using a single `pg.Client` removes only the same-connection
interleave, not this cross-connection window.

**SAFE FOR PRODUCTION MIGRATION = NO.**

### Trust model — `--expected-fingerprint` is verified, not authorised, by the tool

- **Inspection mode** (`db-migrate.mjs --migrations-folder <path>`)
  computes and reports the artifact fingerprint (SHA-256 over every
  selected `.sql` file's bytes, in journal order).
- A production `--apply` **requires** a reviewer/operator-supplied
  `--expected-fingerprint`, which the tool compares byte-for-byte to the
  folder's recomputed fingerprint — before connecting **and** again
  immediately before `migrate()`.
- The code can only verify **equality**. It **cannot** enforce that a
  human other than the person running `--apply` reviewed the artifact.
- Therefore the **migration artifact and its fingerprint MUST receive
  independent human review / approval before a production `--apply`.** An
  operator running inspection mode themselves and pasting that same
  fingerprint straight into their own `--apply` command is **NOT** an
  independent review and does not satisfy this requirement.
- The reviewer MUST review **both**:
  1. the migration **SQL / artifact contents** — every selected `.sql`; and
  2. the **journal identity** — order, `tag`s, and `when` values.

  `--expected-fingerprint` binds only the `.sql` **bytes and their order**;
  journal identity is protected through **separate** guards
  (`--expected-pending` local validation, the `created_at` clean-prefix
  check, and the pre-`migrate()` `journal.identity` re-check), not by the
  fingerprint. A matching fingerprint **alone does not prove
  authorisation.**

### CRM repair vs RBAC migration — keep them separate

| Slice | Migrations | Folder boundary | `--expected-pending` | `--expected-fingerprint` |
|---|---|---|---|---|
| **CRM `0031–0033` repair** (`CRM-PROD-RELEASE-RECON-1` / `-SHA-1`) | `0031_stiff_leech`, `0032_cool_red_wolf`, `0033_reflective_wolf_cub` | a reviewed folder committed under `<repo>/db/` whose journal **ends at `0033`** — never `HEAD` | `0031_stiff_leech,0032_cool_red_wolf,0033_reflective_wolf_cub` | SHA-256 of that folder, captured by the reviewer from inspection mode |
| **RBAC `0034`** (`RBAC-BOOTSTRAP-EXEC`) | `0034_aberrant_earthquake` only | a folder under `<repo>/db/` whose journal ends at `0034`, run **after** the `0031–0033` repair has landed and been verified | `0034_aberrant_earthquake` | SHA-256 of that folder |

Neither slice is authorised by this tooling. Each is its own
human-authorised step with its own pre-apply snapshot.

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
5. **A verified pre-apply snapshot / backup** of the protected DB —
   still a **separate** operator responsibility; the tooling neither takes
   nor checks it.
6. **Explicit authorization** to run `--apply` on the protected DB.
7. **`--migrations-folder`** — a reviewed pinned artifact committed under
   `<repo>/db/` (never `HEAD` for the CRM repair; never an out-of-repo
   path for production).
8. **`--expected-fingerprint`** — the SHA-256 the reviewer captured from
   `db-migrate.mjs --migrations-folder <that path>` (inspection mode). The
   tool re-derives and compares it; it never self-approves.

No secrets are ever required or accepted by these tools (never
`DATABASE_URL`, never tokens on the command line).

## Local (disposable) validation — the only thing this slice runs

```
# unit (no DB, no Docker):
npx tsx --test scripts/db-migrate.test.mjs scripts/bootstrap-first-staff-owner.test.mjs

# integration (needs Docker; each creates + destroys its own postgres:16-alpine):
npx tsx --test scripts/rbac-mig-tooling.integration.test.mjs
npx tsx --test scripts/db-migrate.hardening.integration.test.mjs   # --migrations-folder + --expected-pending + clean-prefix + change-window gates
```

`db-migrate.hardening.integration.test.mjs` builds its `0000..0033`
boundary fixture at runtime by filtering the committed
`db/migrations/meta/_journal.json` to `idx <= 33` and copying those
`.sql` files into a temp dir — historical migrations are never edited and
no fixture is checked into a runtime path. It proves, on a disposable
container, that a `0030`-era database + a `0033`-ending folder +
`--expected-pending 0031,0032,0033` (+ the correct `--expected-fingerprint`)
applies exactly those three, that a wrong `--expected-fingerprint` or a
`.sql` rewritten during the prompt window aborts with zero mutation, that
the `0031`/`0032`/`0033` structural verifiers pass on the real schema (and
report failure when a column is dropped), and that `staff_roles` /
`staff_members` / `staff_invitations` never appear.

## Future execution order (each its own authorized slice)

1. **RBAC-MIG-TOOLING** *(this slice)* — build + locally validate the tools. No protected DB contact.
2. **RBAC-BOOTSTRAP-EXEC** *(separate authorization)* — snapshot → `scripts/db-migrate.mjs --apply` → verify schema + seed → operator OWNER/ADMIN manifest → `scripts/bootstrap-first-staff-owner.mjs --apply` → verify memberships. No code change.
3. **RBAC-RUNTIME-1A** *(separate authorization)* — implement `requireStaffPermission` and wire the first `users.ts` enforcement point, only after the activation-readiness gate is green.

## Rollback posture

- **Code**: each future `users.ts` call site reverts to `requireAdminSession()` in one line.
- **Data**: set bootstrapped `staff_members` rows to `status = 'OFFBOARDING'` or delete them — reversible, no schema change.
- **Never** `DROP` the `staff_*` tables as rollback (migration `0034` is additive).
- Bootstrap writes are reversible independently of the migration.
