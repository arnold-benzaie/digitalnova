// PHASE T-1.4-B-B — pure fail-closed assertion over the E2E server's LIVE
// database targets, as reported by GET /api/gbp-audit/e2e-db-target.
//
// e2e/global-setup.ts fetches that endpoint (which runs `select
// current_database()` on the RUNNING server's own auditDb + db connections)
// and passes the two names here. The whole E2E run must abort before test 1
// unless BOTH are the local Docker test databases:
//
//   mainDatabase  === "public_map_approval_test"   (server main connection)
//   auditDatabase === "public_map_audit_test"      (server Audit connection)
//
// Fail closed: a wrong name, an empty string, null, or undefined all throw.
// The main-DB check runs first. Error text names only the target label, the
// expected name, and the observed name — never a URL, an env var value, a
// host, or a credential.
//
// Pure: no network, no DB, no Clerk, no application-runtime import.

const EXPECTED_MAIN_DATABASE = "public_map_approval_test";
const EXPECTED_AUDIT_DATABASE = "public_map_audit_test";

export type E2EDatabaseTargets = {
  mainDatabase: string | null | undefined;
  auditDatabase: string | null | undefined;
};

function assertOneTarget(label: "main" | "audit", expected: string, observed: string | null | undefined): void {
  if (observed === expected) return;
  const shown = observed === null ? "null" : observed === undefined ? "undefined" : JSON.stringify(observed);
  throw new Error(
    `E2E ${label} database target check failed: expected "${expected}", observed ${shown}. ` +
      "The running E2E server is not connected to the local Docker test database — refusing to run the suite. See e2e/README.md.",
  );
}

/**
 * Throws unless the running E2E server reports BOTH expected local test
 * database names. Call from e2e/global-setup.ts before any test may run,
 * before the auth-file check and before rate-limit cleanup.
 */
export function assertE2EDatabaseTargets({ mainDatabase, auditDatabase }: E2EDatabaseTargets): void {
  assertOneTarget("main", EXPECTED_MAIN_DATABASE, mainDatabase);
  assertOneTarget("audit", EXPECTED_AUDIT_DATABASE, auditDatabase);
}
