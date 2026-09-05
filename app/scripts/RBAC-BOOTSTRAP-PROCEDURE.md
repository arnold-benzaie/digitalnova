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
| `scripts/bootstrap-first-staff-owner.mjs` | Reviewed first OWNER/ADMIN bootstrap — creates exactly one `OWNER` `staff_members` row plus one `ADMIN` row per explicitly-approved current active internal admin. Dry-run by default; one transaction, serialized per workspace by a `pg_advisory_xact_lock` (see "Bootstrap workspace-scoped serialization" below); idempotent; fail-closed. |
| `scripts/bootstrap-first-staff-owner.concurrency.integration.test.mjs` | Disposable-container proof that the workspace-scoped advisory lock actually serializes two genuinely concurrent bootstrap attempts for the same workspace — real `pg.Client` connections, no mocked interleaving. |
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

## Bootstrap workspace-scoped serialization (RBAC-BOOTSTRAP-CONCURRENCY-HARDENING-1)

**Gap this closes:** before this hardening, `bootstrap-first-staff-owner.mjs`'s
only workspace-wide "does this workspace already have a privileged set?"
check ran **before** `BEGIN`. Everything inside the write transaction —
`resolveInternalAdmin` re-checks and the per-user-id conflict `SELECT` —
only reasons about **that invocation's own** candidate ids, never "does
this workspace already have an OWNER at all, for any user?". Two
concurrent invocations bootstrapping **two different** OWNER candidates
for the **same** workspace could each observe an empty pre-`BEGIN` read,
each pass their own candidate-only re-checks, and both `COMMIT` — nothing
in the schema forbids two different users both holding `role_id = OWNER`
in one workspace (`staff_members_user_workspace_unique` only prevents the
**same** user from having two rows in the same workspace). This is a
**tool/application-level** gap, distinct from the already-documented
`db-migrate.mjs` "Residual DB race" above (which concerns migration
metadata replay, not OWNER uniqueness).

**IMPORTANT — this remains APPLICATION/TOOL ENFORCEMENT, not a DATABASE
CONSTRAINT.** No schema change was made. There is still no partial unique
index, exclusion constraint, or check constraint in `db/schema.ts` /
migration `0034` preventing two `staff_members` rows with `role_id =
OWNER` in the same `workspace_org_id`. A direct SQL write that bypasses
this tool entirely (`psql`, the Supabase SQL editor, a different script)
is **not** protected by anything below. The guarantee described here holds
**only** for writes that go through `bootstrap-first-staff-owner.mjs`.

**The fix — a transaction-scoped advisory lock:**

```sql
select pg_advisory_xact_lock(hashtext('rbac-staff-bootstrap'), hashtext($1::text));
```

with `$1` = the resolved internal workspace id (`organizations.id` where
`is_internal = true`).

- **Acquisition point:** the very first statement inside the write
  transaction, **before** the authoritative eligibility re-read and
  before the pre-existing candidate-specific re-checks.
- **Key derivation:** `hashtext('rbac-staff-bootstrap')` (a fixed
  namespace) + `hashtext(workspace_id::text)` (the two-argument
  `pg_advisory_xact_lock(int, int)` form) — deterministic per workspace,
  scoped to **one** workspace only. A different workspace id hashes to a
  different second key and is **never** blocked by this one (proven by
  `bootstrap-first-staff-owner.concurrency.integration.test.mjs`, which
  exercises the raw lock primitive directly with two distinct UUIDs).
- **Release:** `pg_advisory_xact_lock` is transaction-scoped — it is
  released automatically on **either** `COMMIT` or `ROLLBACK`. No manual
  `pg_advisory_unlock` call exists or is needed. Unlike a session-level
  advisory lock, it cannot outlive the transaction if the process dies
  mid-write.
- **Authoritative re-read moved under the lock:** immediately after
  acquiring the lock, the transaction re-reads the workspace's full
  `staff_members` set (the same query the pre-`BEGIN` fast-path uses) and
  makes the real eligibility decision from **that** read — not the
  pre-`BEGIN` one. A second concurrent invocation for the **same**
  workspace blocks on the lock until the first transaction ends, then its
  own re-read is guaranteed to observe whatever the first one committed
  (or, if the first rolled back, the pre-existing empty state). If the
  now-current state exactly matches this invocation's own manifest, it
  reports `alreadyBootstrapped` with zero mutation; if it differs, it
  refuses — **never** reconciles, overwrites, or auto-promotes/demotes
  anyone. The pre-`BEGIN` read is kept as an operator-friendly **fast
  path only** (fail fast without opening a transaction for the common
  "already done" / "obviously conflicting" case) — it is explicitly *not*
  the safety boundary.
- **Existing candidate-specific rechecks preserved** (owner + each admin
  `resolveInternalAdmin` re-check, and the per-user-id conflict `SELECT`)
  as additional defense-in-depth, unchanged in behavior.

**Test coverage** —
`scripts/bootstrap-first-staff-owner.concurrency.integration.test.mjs`
(disposable `postgres:16-alpine`; every invocation drives a REAL, independent
`pg.Client` against the REAL bootstrap implementation — nothing about its
SQL or control flow is reimplemented or mocked in any of the tests below):

1. **Two different eligible OWNER candidates**, synchronized with an
   explicit test-only rendezvous barrier (`makeBarrier` /
   `barrierConnectFn`) so both invocations are DETERMINISTICALLY forced
   to reach the `pg_advisory_xact_lock` statement at the same real time —
   not `Promise.all` scheduling luck. **This specific test — and only
   this one — independently proves the fix**, per the negative control
   below. → exactly one commits, the workspace ends with exactly one
   `OWNER` row (verified directly against the disposable database, not
   from the JS return values alone), the surviving `ADMIN` row belongs
   only to the winning manifest, the loser is refused/rolled back with
   zero partial/orphan rows.
2. The **same** manifest fired twice concurrently (`Promise.all`, no
   barrier needed) → converges to exactly one committed OWNER+ADMIN set,
   no duplication; both invocations return `ok: true` (one
   `mutated: true`, the other `alreadyBootstrapped: true`). This test
   also independently discriminates (see negative control below) —
   without the hardening the loser hits a raw `staff_members_user_workspace_unique`
   violation and returns `ok: false`, failing this test's assertions.
3. A failure injected **after** lock acquisition (a poisoned `INSERT`) →
   the transaction rolls back, zero partial `staff_members` rows remain,
   and a subsequent valid bootstrap for the same workspace proceeds
   immediately (bounded by a timeout in the test) — proving the lock does
   not outlive the failed transaction. This test exercises the hardened
   code's own correctness and is not intended as a hardened-vs-unhardened
   discriminator.
4. The raw lock primitive, tested directly (two raw connections, explicit
   `sleep()`-gated assertions — deterministic, not timing-dependent):
   two different workspace ids never block each other; the same
   workspace id does block until the holder's transaction ends. These
   prove the underlying mechanism in isolation from the tool's business
   logic.

**Negative control (RBAC-BOOTSTRAP-CONCURRENCY-TEST-FIX-1):** an earlier,
`Promise.all`-only version of test 1 was found, during independent review,
to pass 6/6 times even against a disposable scratch copy with the lock and
authoritative reread entirely removed — because the pre-existing
post-insert verification already happened to catch the race under normal
local-disposable-DB timing, not because of the fix. The barrier-based
version of test 1 was verified against the same kind of reverted scratch
copy (never a tracked file) and reliably **fails** — deterministically,
not probabilistically — reproducing the exact double-`OWNER`-commit the
hardening exists to prevent (`{mutated:true}` for **both** invocations,
`2 !== 1` distinct `OWNER` rows), confirming the barrier genuinely forces
the race window the lock closes. Test 2 (same manifest) was independently
confirmed to already reliably fail pre-hardening (4/4) via the same
method. Tests 3 and 4 test properties of the hardened code itself
(lock release, primitive scoping) rather than discriminating
hardened-vs-unhardened, and are not claimed to.

**Not tested end-to-end at the bootstrap-tool level:** two real internal
workspaces racing against each other through the *full* tool. `db/schema.ts`'s
`organizations_is_internal_unique` (a partial unique index on
`organizations(is_internal) WHERE is_internal = true`) enforces at most
one internal workspace can ever exist, and the tool itself refuses unless
exactly one is found — so a genuine two-internal-workspace scenario cannot
be constructed without violating a real production invariant, and doing
so would not usefully test lock scoping anyway (the tool would refuse
before reaching the lock). The lock-scoping guarantee is instead verified
at the underlying primitive level (item 4 above), which is what the tool's
per-invocation key derivation actually depends on.

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
npx tsx --test scripts/bootstrap-first-staff-owner.concurrency.integration.test.mjs   # workspace-scoped advisory lock: real concurrent OWNER races
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
