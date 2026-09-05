#!/usr/bin/env node
/**
 * PHASE RBAC-MIG-TOOLING — reviewed first OWNER/ADMIN bootstrap tool.
 *
 * ⚠ TOOLING ONLY. This script DOES NOT authorize production execution.
 *   A real protected-DB bootstrap requires SEPARATE human authorization,
 *   `--apply`, the typed token "BOOTSTRAP", `--confirm-owner-id <uuid>`
 *   matching the RESOLVED owner id, all three production signals (see
 *   scripts/lib/protected-db-target.mjs), and a completed migration 0034.
 *   See scripts/RBAC-BOOTSTRAP-PROCEDURE.md.
 *
 * Creates the FIRST internal-workforce staff_members rows:
 *   - exactly ONE OWNER, and
 *   - one ADMIN per explicitly-approved current ACTIVE internal admin.
 * Nothing else. NO MANAGER/EMPLOYEE bootstrap. NO promotion of
 * client/staff/agent/supervisor. Migration 0034 itself never chooses the
 * OWNER — this tool does, from an explicit, human-approved manifest.
 *
 * SOURCE OF TRUTH for every write is `users.id` (a stable UUID). A
 * manifest MAY use `ownerEmail` / `adminEmails` for legibility: each is
 * resolved (read-only) to exactly one ACTIVE `admin` member of the single
 * internal workspace, the resolved `users.id` is displayed, and the real
 * write is keyed only by that UUID. `--apply` additionally requires
 * `--confirm-owner-id` to equal the resolved owner UUID — email alone can
 * never authorize the write.
 *
 * DEFAULT MODE = DRY-RUN: resolves + validates every identity, prints the
 * exact planned rows, performs ZERO writes.
 *
 * REAL WRITE (`--apply`): all inserts happen in ONE transaction, with the
 * safety-sensitive invariants re-checked inside it and a full post-insert
 * verification before COMMIT; any failure ROLLs BACK the whole bootstrap.
 *
 * IDEMPOTENT: an exact re-run after success detects the identical rows,
 * reports "already bootstrapped", and exits 0 with zero mutation. A
 * DIFFERENT owner/admin set, or any unexpected privileged row, is
 * REFUSED — this tool never silently "fixes" privileged state.
 *
 * Never prints DATABASE_URL, credentials, tokens, or full emails.
 *
 * Usage:
 *   npx tsx scripts/bootstrap-first-staff-owner.mjs --manifest <path>
 *       dry-run — resolves, validates, prints the plan, writes nothing
 *   RBAC_BOOTSTRAP_TARGET=production-main \
 *   npx tsx scripts/bootstrap-first-staff-owner.mjs --manifest <path> --apply --confirm-owner-id <uuid>
 *       real write against DATABASE_URL, guarded (needs all three signals + typed BOOTSTRAP)
 *   RBAC_MIG_TEST_MODE=1 npx tsx scripts/bootstrap-first-staff-owner.mjs \
 *       --manifest <path> --db-url <127.0.0.1 url> --apply --confirm-owner-id <uuid>
 *       disposable-container write only (used by the integration test)
 */
import { config as loadDotenv } from "dotenv";
import { readFileSync } from "node:fs";
import { createInterface } from "node:readline/promises";
import {
  classifyTarget,
  PRODUCTION_ENV_MARKER_ENV,
  TEST_MODE_ENV,
} from "./lib/protected-db-target.mjs";

export const CONFIRMATION_TOKEN = "BOOTSTRAP";
export const UUID_RE = /^[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}$/i;
const ACTIVE_USER_STATUS = "active";
const LEGACY_ADMIN_ROLE = "admin";

/** Redacted email for display: first char + domain only. */
export function redactEmail(email) {
  const s = String(email ?? "");
  const at = s.indexOf("@");
  if (at <= 0) return "(invalid email)";
  return `${s[0]}***${s.slice(at)}`;
}

function parseArgs(argv) {
  const has = (f) => argv.includes(f);
  const val = (f) => {
    const i = argv.indexOf(f);
    return i >= 0 && i + 1 < argv.length ? argv[i + 1] : undefined;
  };
  return {
    apply: has("--apply"),
    manifestPath: val("--manifest"),
    confirmOwnerId: val("--confirm-owner-id"),
    dbUrl: val("--db-url"),
  };
}

export function validateManifest(m) {
  const errs = [];
  if (!m || typeof m !== "object") return ["manifest is not an object"];
  const hasOwner = typeof m.ownerUserId === "string" || typeof m.ownerEmail === "string";
  if (!hasOwner) errs.push("manifest must contain ownerUserId or ownerEmail");
  if (m.ownerUserId !== undefined && m.ownerUserId !== null && !UUID_RE.test(String(m.ownerUserId))) errs.push("ownerUserId is not a UUID");
  for (const id of m.adminUserIds ?? []) if (!UUID_RE.test(String(id))) errs.push(`adminUserIds entry "${id}" is not a UUID`);
  if (m.expectedWorkspaceOrgId !== undefined && m.expectedWorkspaceOrgId !== null && !UUID_RE.test(String(m.expectedWorkspaceOrgId)))
    errs.push("expectedWorkspaceOrgId is not a UUID");
  if (!m.expectedDbName || typeof m.expectedDbName !== "string") errs.push("manifest must contain expectedDbName (the operator-declared current_database())");
  return errs;
}

/**
 * Resolve one legacy-admin identity (by id or email) against the single
 * internal workspace. Returns { ok, id?, reason? }. Fails closed on
 * 0 / >1 matches, wrong status, wrong role, or wrong workspace.
 */
async function resolveInternalAdmin(conn, { userId, email }, internalOrgId) {
  let rows;
  if (userId) {
    rows = (
      await conn.query(
        `select u.id, u.status, m.organization_id, r.name as role
           from users u
           join memberships m on m.user_id = u.id
           join roles r on r.id = m.role_id
          where u.id = $1`,
        [userId],
      )
    ).rows;
  } else {
    rows = (
      await conn.query(
        `select u.id, u.status, m.organization_id, r.name as role
           from users u
           join memberships m on m.user_id = u.id
           join roles r on r.id = m.role_id
          where lower(u.email) = lower($1)`,
        [email],
      )
    ).rows;
  }
  const label = userId ? `user ${userId}` : `email ${redactEmail(email)}`;
  if (rows.length === 0) return { ok: false, reason: `${label}: no matching user+membership` };
  if (rows.length > 1) return { ok: false, reason: `${label}: ${rows.length} matching rows (expected exactly 1)` };
  const row = rows[0];
  if (row.status !== ACTIVE_USER_STATUS) return { ok: false, reason: `${label}: status "${row.status}" (expected "${ACTIVE_USER_STATUS}")` };
  if (row.role !== LEGACY_ADMIN_ROLE) return { ok: false, reason: `${label}: legacy role "${row.role}" (expected "${LEGACY_ADMIN_ROLE}")` };
  if (row.organization_id !== internalOrgId)
    return { ok: false, reason: `${label}: membership org is not the internal workspace` };
  return { ok: true, id: row.id };
}

/** The current staff_members set for one workspace, as {user_id, role, status} rows. */
async function readStaffMembersSet(conn, internalOrgId) {
  return (
    await conn.query(
      `select sm.user_id, sr.name as role, sm.status
         from staff_members sm
         join staff_roles sr on sr.id = sm.role_id
        where sm.workspace_org_id = $1`,
      [internalOrgId],
    )
  ).rows;
}

/** True iff `existing` is exactly `planned` (same user:role pairs, order-insensitive) and every row is ACTIVE. */
function matchesPlanExactly(existing, planned) {
  const key = (rows) => rows.map((r) => `${r.user_id}:${r.role}`).sort().join("|");
  return existing.length > 0 && key(existing) === key(planned) && existing.every((r) => r.status === "ACTIVE");
}

/**
 * Injectable core.
 *   connectFn(url) -> { query(sql, params?) -> { rows }, end() }
 * The bootstrap transaction is driven with plain BEGIN/COMMIT/ROLLBACK
 * through `query`, so a unit-test fake only has to implement `query`.
 */
export async function run({
  argv = process.argv.slice(2),
  env = process.env,
  promptFn,
  log = console.log,
  error = console.error,
  connectFn,
  readManifestFn = (p) => JSON.parse(readFileSync(p, "utf8")),
} = {}) {
  const { apply, manifestPath, confirmOwnerId, dbUrl } = parseArgs(argv);
  const testMode = env[TEST_MODE_ENV];
  const envMarker = env[PRODUCTION_ENV_MARKER_ENV];

  if (!manifestPath) {
    error("✗ REFUSED: --manifest <path> is required. See scripts/rbac-bootstrap-manifest.example.json.");
    return { ok: false, refused: true, mutated: false, reason: "no manifest" };
  }
  let manifest;
  try {
    manifest = readManifestFn(manifestPath);
  } catch (err) {
    error(`✗ REFUSED: cannot read manifest "${manifestPath}": ${err.message}`);
    return { ok: false, refused: true, mutated: false, reason: "manifest unreadable" };
  }
  const manifestErrors = validateManifest(manifest);
  if (manifestErrors.length) {
    error(`✗ REFUSED: invalid manifest:\n  - ${manifestErrors.join("\n  - ")}`);
    return { ok: false, refused: true, mutated: false, reason: "invalid manifest" };
  }

  const connectionString = testMode === "1" ? dbUrl : env.DATABASE_URL;
  if (!connectionString) {
    error(
      testMode === "1"
        ? "✗ REFUSED: RBAC_MIG_TEST_MODE=1 requires --db-url <127.0.0.1 url>."
        : "✗ REFUSED: DATABASE_URL is required in the environment.",
    );
    return { ok: false, refused: true, mutated: false, reason: "no connection string" };
  }

  const connect = connectFn ?? (await defaultConnect());
  let conn;
  try {
    conn = await connect(connectionString);
  } catch (err) {
    error(`✗ REFUSED: could not connect (details withheld): ${sanitizeError(err)}`);
    return { ok: false, refused: true, mutated: false, reason: "connect failed" };
  }

  try {
    // ---- target classification -----------------------------------
    const observed = (await conn.query("select current_database() as db")).rows?.[0]?.db;
    const decision = classifyTarget({
      connectionString,
      expectedDbName: manifest.expectedDbName,
      envMarker,
      testMode,
      observedDbName: observed,
    });

    log("─".repeat(64));
    log("PUBLIC-MAP — first internal-workforce OWNER/ADMIN bootstrap");
    log("─".repeat(64));
    log(`  Target host       : ${decision.redacted.host}:${decision.redacted.port}`);
    log(`  Target database   : ${decision.redacted.database}  (current_database(): ${observed ?? "unknown"})`);
    log(`  Classification    : ${decision.classification}  (${decision.reason})`);

    if (decision.classification === "REFUSED") {
      error(`✗ REFUSED: ${decision.reason}. Nothing written.`);
      return { ok: false, refused: true, mutated: false, classification: decision.classification, reason: decision.reason };
    }

    // ---- internal workspace -------------------------------------
    const orgRows = (await conn.query(`select id from organizations where is_internal = true`)).rows;
    if (orgRows.length !== 1) {
      error(`✗ REFUSED: expected exactly one internal workspace (organizations.is_internal = true); found ${orgRows.length}.`);
      return { ok: false, refused: true, mutated: false, reason: "internal workspace not unique" };
    }
    const internalOrgId = orgRows[0].id;
    if (manifest.expectedWorkspaceOrgId && manifest.expectedWorkspaceOrgId !== internalOrgId) {
      error(`✗ REFUSED: resolved internal workspace ${internalOrgId} != manifest.expectedWorkspaceOrgId.`);
      return { ok: false, refused: true, mutated: false, reason: "workspace id mismatch" };
    }

    // ---- staff role catalogue ----------------------------------
    const roleRows = (await conn.query(`select id, name from staff_roles where name in ('OWNER','ADMIN')`)).rows;
    const roleId = Object.fromEntries(roleRows.map((r) => [r.name, r.id]));
    if (!roleId.OWNER || !roleId.ADMIN) {
      error(`✗ REFUSED: staff_roles is missing OWNER and/or ADMIN — apply migration 0034 first (scripts/db-migrate.mjs).`);
      return { ok: false, refused: true, mutated: false, reason: "staff roles missing" };
    }

    // ---- resolve OWNER + ADMIN identities ----------------------
    const ownerRes = await resolveInternalAdmin(
      conn,
      { userId: manifest.ownerUserId ?? undefined, email: manifest.ownerUserId ? undefined : manifest.ownerEmail },
      internalOrgId,
    );
    if (!ownerRes.ok) {
      error(`✗ REFUSED: OWNER resolution failed — ${ownerRes.reason}.`);
      return { ok: false, refused: true, mutated: false, reason: `owner: ${ownerRes.reason}` };
    }
    const ownerId = ownerRes.id;

    const adminInputs = [
      ...(manifest.adminUserIds ?? []).map((id) => ({ userId: id })),
      ...(manifest.adminEmails ?? []).map((email) => ({ email })),
    ];
    const adminIds = [];
    for (const input of adminInputs) {
      const r = await resolveInternalAdmin(conn, input, internalOrgId);
      if (!r.ok) {
        error(`✗ REFUSED: ADMIN resolution failed — ${r.reason}.`);
        return { ok: false, refused: true, mutated: false, reason: `admin: ${r.reason}` };
      }
      if (r.id === ownerId) {
        error(`✗ REFUSED: ${r.id} is listed as both OWNER and ADMIN.`);
        return { ok: false, refused: true, mutated: false, reason: "owner also in admin list" };
      }
      if (adminIds.includes(r.id)) {
        error(`✗ REFUSED: ADMIN ${r.id} appears more than once in the manifest.`);
        return { ok: false, refused: true, mutated: false, reason: "duplicate admin" };
      }
      adminIds.push(r.id);
    }

    const planned = [
      { userId: ownerId, role: "OWNER" },
      ...adminIds.map((id) => ({ userId: id, role: "ADMIN" })),
    ];

    // ---- existing privileged rows / idempotency (fast-path only) ------
    // This is an operator-friendly EARLY exit, not the safety boundary:
    // it runs before BEGIN, so two concurrent invocations for the SAME
    // workspace could both pass it. The authoritative, race-free decision
    // is the re-read taken under the workspace advisory lock inside the
    // transaction below (see "workspace-scoped serialization").
    const plannedRows = planned.map((p) => ({ user_id: p.userId, role: p.role }));
    const existing = await readStaffMembersSet(conn, internalOrgId);

    if (existing.length > 0) {
      if (matchesPlanExactly(existing, plannedRows)) {
        log("");
        log("  = Already bootstrapped — the internal workspace already holds exactly this");
        log("    OWNER/ADMIN staff_members set, all ACTIVE. Zero mutation.");
        log("─".repeat(64));
        return { ok: true, alreadyBootstrapped: true, mutated: false, owner: ownerId, admins: adminIds };
      }
      error("✗ REFUSED: the internal workspace already has staff_members rows that do NOT match this manifest.");
      error("  Existing (user_id:role): " + (existing.map((r) => `${r.user_id}:${r.role}(${r.status})`).join(", ") || "(none)"));
      error("  This tool never modifies an existing privileged set. A change requires a separately-designed procedure.");
      return { ok: false, refused: true, mutated: false, reason: "unexpected existing privileged rows" };
    }

    // ---- print the plan --------------------------------------
    log("");
    log(`  Internal workspace : ${internalOrgId}`);
    log(`  Planned staff_members rows (status ACTIVE):`);
    log(`    OWNER  ${ownerId}`);
    for (const id of adminIds) log(`    ADMIN  ${id}`);
    log("");

    if (!apply) {
      log("  Mode : DRY-RUN (default) — resolved, validated, plan printed. Nothing written.");
      log(`  To write: re-run with --apply --confirm-owner-id ${ownerId}, ${PRODUCTION_ENV_MARKER_ENV}=production-main`);
      log(`  in the environment, and type "${CONFIRMATION_TOKEN}" when prompted.`);
      log("  scripts/RBAC-BOOTSTRAP-PROCEDURE.md — this tool does not authorize production execution.");
      log("─".repeat(64));
      return { ok: true, mode: "dry-run", mutated: false, owner: ownerId, admins: adminIds, planned };
    }

    // ---- apply gates -----------------------------------------
    if (!confirmOwnerId || String(confirmOwnerId).trim() !== ownerId) {
      error(`✗ REFUSED: --confirm-owner-id must equal the RESOLVED owner id (${ownerId}). Got "${confirmOwnerId ?? "(none)"}".`);
      return { ok: false, refused: true, mutated: false, reason: "owner id confirmation mismatch" };
    }
    const ask =
      promptFn ??
      (async () => {
        const rl = createInterface({ input: process.stdin, output: process.stdout });
        const a = await rl.question(`Type "${CONFIRMATION_TOKEN}" to write the rows above, anything else to cancel: `);
        rl.close();
        return a;
      });
    const answer = await ask();
    if (String(answer).trim() !== CONFIRMATION_TOKEN) {
      log("Cancelled — nothing written.");
      return { ok: true, cancelled: true, mutated: false, owner: ownerId, admins: adminIds };
    }

    // ---- one transaction -----------------------------------
    log("Writing OWNER + ADMIN rows in a single transaction...");
    await conn.query("BEGIN");
    try {
      // ---- workspace-scoped serialization ------------------------
      // Transaction-scoped advisory lock keyed off the resolved internal
      // workspace id (hashtext of the two-argument form, so it never
      // collides with any other advisory lock namespace in this DB).
      // Scoped to ONE workspace: a different workspace hashes to a
      // different second key and is never blocked by this one. Acquired
      // BEFORE the authoritative eligibility re-read below, so a second
      // concurrent bootstrap for the SAME workspace waits here until the
      // first transaction ends. Auto-released on COMMIT *or* ROLLBACK —
      // no manual unlock, and it cannot outlive this transaction the way
      // a session-level advisory lock could if the process died mid-tx.
      //
      // Why this is needed: the pre-tx "existing" read above, and the
      // candidate-specific re-checks below (resolveInternalAdmin for
      // OWNER/each ADMIN, and the per-user-id conflict SELECT), only ever
      // reason about THIS invocation's own candidate ids. Nothing before
      // this lock asks "does this workspace already have an OWNER at
      // all, for ANY user?" — so two concurrent invocations bootstrapping
      // two DIFFERENT OWNER candidates for the SAME workspace could each
      // observe an empty pre-tx read, each pass their own candidate-only
      // re-checks, and both COMMIT. Nothing in the schema forbids two
      // different users both holding role_id = OWNER in one workspace
      // (staff_members_user_workspace_unique only prevents the SAME user
      // from having two rows in the same workspace) — so that race is a
      // real path to two OWNER rows without this lock.
      await conn.query("select pg_advisory_xact_lock(hashtext('rbac-staff-bootstrap'), hashtext($1::text))", [internalOrgId]);

      // ---- authoritative workspace-wide re-read (under the lock) -----
      // This — not the pre-tx fast-path above — is what actually decides
      // whether the bootstrap may proceed. It is guaranteed to observe
      // any state a previously-serialized invocation for this SAME
      // workspace committed, because that invocation's lock has already
      // been released (COMMIT/ROLLBACK) by the time this query runs.
      const lockedExisting = await readStaffMembersSet(conn, internalOrgId);
      if (lockedExisting.length > 0) {
        if (matchesPlanExactly(lockedExisting, plannedRows)) {
          await conn.query("ROLLBACK");
          log("");
          log("  = Already bootstrapped (observed under the workspace lock) — zero mutation.");
          log("─".repeat(64));
          return { ok: true, alreadyBootstrapped: true, mutated: false, owner: ownerId, admins: adminIds };
        }
        throw new Error(
          "workspace already has staff_members rows that do not match this manifest, observed under the " +
            "workspace lock (a concurrent bootstrap won the race): " +
            (lockedExisting.map((r) => `${r.user_id}:${r.role}(${r.status})`).join(", ") || "(none)"),
        );
      }

      // re-check inside the tx (candidate-specific — kept as additional
      // defense-in-depth; the workspace-wide re-read above is the actual
      // race-free authorization boundary)
      const reOwner = await resolveInternalAdmin(conn, { userId: ownerId }, internalOrgId);
      if (!reOwner.ok) throw new Error(`owner re-check failed inside tx: ${reOwner.reason}`);
      for (const id of adminIds) {
        const reAdmin = await resolveInternalAdmin(conn, { userId: id }, internalOrgId);
        if (!reAdmin.ok) throw new Error(`admin ${id} re-check failed inside tx: ${reAdmin.reason}`);
      }
      const conflict = (
        await conn.query(
          `select user_id from staff_members where workspace_org_id = $1 and user_id = any($2::uuid[])`,
          [internalOrgId, [ownerId, ...adminIds]],
        )
      ).rows;
      if (conflict.length) throw new Error(`conflicting staff_members row(s) appeared for ${conflict.map((r) => r.user_id).join(", ")}`);

      await conn.query(
        `insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1, $2, $3, 'ACTIVE')`,
        [ownerId, internalOrgId, roleId.OWNER],
      );
      for (const id of adminIds) {
        await conn.query(
          `insert into staff_members (user_id, workspace_org_id, role_id, status) values ($1, $2, $3, 'ACTIVE')`,
          [id, internalOrgId, roleId.ADMIN],
        );
      }

      const after = (
        await conn.query(
          `select sm.user_id, sr.name as role, sm.status
             from staff_members sm join staff_roles sr on sr.id = sm.role_id
            where sm.workspace_org_id = $1`,
          [internalOrgId],
        )
      ).rows;
      const owners = after.filter((r) => r.role === "OWNER");
      const admins = after.filter((r) => r.role === "ADMIN");
      const bad =
        owners.length !== 1 ||
        owners[0].user_id !== ownerId ||
        admins.length !== adminIds.length ||
        !admins.every((r) => adminIds.includes(r.user_id)) ||
        after.some((r) => r.status !== "ACTIVE") ||
        after.length !== planned.length;
      if (bad) throw new Error(`post-insert verification failed: got ${JSON.stringify(after)}`);

      await conn.query("COMMIT");
      log(`  ✓ Committed: 1 OWNER + ${adminIds.length} ADMIN, all ACTIVE, workspace ${internalOrgId}.`);
      log("─".repeat(64));
      return { ok: true, mutated: true, owner: ownerId, admins: adminIds, classification: decision.classification };
    } catch (txErr) {
      await conn.query("ROLLBACK").catch(() => {});
      error(`✗ ROLLED BACK — ${txErr.message}. No rows were written.`);
      return { ok: false, mutated: false, rolledBack: true, reason: txErr.message };
    }
  } finally {
    await conn.end?.().catch(() => {});
  }
}

function sanitizeError(err) {
  return String(err?.code ?? err?.message ?? err).replace(/postgres(ql)?:\/\/\S+/gi, "<redacted>");
}

async function defaultConnect() {
  const { Client } = await import("pg");
  return async (connectionString) => {
    const client = new Client({ connectionString });
    await client.connect();
    return {
      query: (sql, params) => client.query(sql, params),
      end: () => client.end(),
    };
  };
}

const isMain = import.meta.url === `file://${process.argv[1]}`;
if (isMain) {
  loadDotenv({ path: ".env.local" });
  const result = await run();
  process.exit(result.ok ? 0 : 1);
}
