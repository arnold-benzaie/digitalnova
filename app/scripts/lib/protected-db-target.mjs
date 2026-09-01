// PHASE RBAC-MIG-TOOLING — shared positive DB-target classifier for the
// two RBAC migration/bootstrap tools (scripts/db-migrate.mjs,
// scripts/bootstrap-first-staff-owner.mjs). Centralised here so the
// safety-critical "is this the production main DB, a disposable test DB,
// or neither?" decision cannot drift between the two scripts.
//
// A target is PRODUCTION-MAIN only when ALL THREE signals hold:
//   1. looksLikeMainProduction(connectionString) === true
//      (db/guard-main-production.ts — matches the known main-production
//      project ref; this is an identifier, not a secret).
//   2. observedDbName === the operator-supplied expectedDbName, where
//      observedDbName is the result of `select current_database()` run by
//      the CALLER (this module never opens a connection).
//   3. an explicit env marker: RBAC_BOOTSTRAP_TARGET === "production-main".
// A missing / mismatched signal 2 or 3, or a false signal 1, means the
// target is NOT positively identified as production and is REFUSED.
// Deliberately never "non-local, therefore production".
//
// A target is TEST-DISPOSABLE only on an explicit opt-in that a
// production URL can never satisfy:
//   - env RBAC_MIG_TEST_MODE === "1", AND
//   - the URL host is exactly 127.0.0.1 (the disposable-container
//     convention already used by db/schema.rbac.integration.test.mjs and
//     scripts/migration-replay-check.mjs), AND
//   - the connection string does NOT carry the main-production signature.
//   - if expectedDbName is supplied, observedDbName must match it too.
//
// Anything else → REFUSED.
//
// This module never logs, returns, or embeds the connection string,
// username, password, or any token. `redactConnection()` returns only
// host / port / database — the same shape scripts/db-push-local.mjs and
// scripts/audit-db-migrate.mjs already print.
import { looksLikeMainProduction } from "../../db/guard-main-production.ts";

export const PRODUCTION_ENV_MARKER = "production-main";
export const TEST_MODE_ENV = "RBAC_MIG_TEST_MODE";
export const PRODUCTION_ENV_MARKER_ENV = "RBAC_BOOTSTRAP_TARGET";

/** Only what is safe to print — never username / password / query string. */
export function redactConnection(connectionString) {
  try {
    const u = new URL(connectionString);
    return { host: u.hostname, port: u.port || "5432", database: u.pathname.replace(/^\//, "") || "(unknown)" };
  } catch {
    return { host: "(unparseable connection string)", port: "?", database: "?" };
  }
}

/**
 * Pure classification. The caller supplies the declared operator signals
 * plus `observedDbName` (from its own `select current_database()` — this
 * function never connects). Returns:
 *   { classification: "PRODUCTION-MAIN" | "TEST-DISPOSABLE" | "REFUSED",
 *     reason: string, redacted: { host, port, database } }
 *
 * Inputs:
 *   connectionString  — required
 *   expectedDbName    — operator-supplied expected current_database() (no default; never guessed)
 *   envMarker         — value of process.env[RBAC_BOOTSTRAP_TARGET]
 *   testMode          — value of process.env[RBAC_MIG_TEST_MODE]
 *   observedDbName    — result of select current_database(), or undefined if not yet read
 */
export function classifyTarget({ connectionString, expectedDbName, envMarker, testMode, observedDbName } = {}) {
  const redacted = redactConnection(connectionString ?? "");

  if (!connectionString || String(connectionString).trim() === "") {
    return { classification: "REFUSED", reason: "no connection string supplied", redacted };
  }

  let host;
  try {
    host = new URL(connectionString).hostname;
  } catch {
    return { classification: "REFUSED", reason: "connection string is not a valid URL", redacted };
  }

  const signature = looksLikeMainProduction(connectionString);

  // ---- disposable-test path: explicit opt-in, 127.0.0.1 only ----------
  if (testMode === "1") {
    if (host !== "127.0.0.1") {
      return {
        classification: "REFUSED",
        reason: `${TEST_MODE_ENV}=1 requires a 127.0.0.1 host (disposable container only); got "${host}"`,
        redacted,
      };
    }
    if (signature) {
      return {
        classification: "REFUSED",
        reason: "connection string carries the main-production signature — it cannot be a disposable test target",
        redacted,
      };
    }
    if (expectedDbName && observedDbName !== undefined && observedDbName !== expectedDbName) {
      return {
        classification: "REFUSED",
        reason: `current_database() "${observedDbName}" != expected "${expectedDbName}"`,
        redacted,
      };
    }
    return {
      classification: "TEST-DISPOSABLE",
      reason: `explicit ${TEST_MODE_ENV}=1 + 127.0.0.1 host + no production signature`,
      redacted,
    };
  }

  // ---- production-main path: ALL THREE signals required ---------------
  const signal2 = Boolean(expectedDbName) && observedDbName !== undefined && observedDbName === expectedDbName;
  const signal3 = envMarker === PRODUCTION_ENV_MARKER;

  if (signature && signal2 && signal3) {
    return { classification: "PRODUCTION-MAIN", reason: "all three production signals present", redacted };
  }

  const missing = [
    !signature && "main-production connection signature (looksLikeMainProduction)",
    !expectedDbName
      ? "--expected-db not supplied"
      : observedDbName === undefined
        ? "current_database() not yet read (no connection)"
        : !signal2 && `current_database() "${observedDbName}" != expected "${expectedDbName}"`,
    !signal3 && `env ${PRODUCTION_ENV_MARKER_ENV} != "${PRODUCTION_ENV_MARKER}"`,
  ].filter(Boolean);

  return {
    classification: "REFUSED",
    reason: `not a positively-identified production-main target — missing/failed: ${missing.join("; ")}`,
    redacted,
  };
}
