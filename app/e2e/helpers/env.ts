/**
 * Local Docker test database for the Audit app — the SAME instance already
 * used all session for migrations/testing (`public-map-audit-test-db`,
 * port 5433). Deliberately NOT read from .env.local: that file's
 * AUDIT_DATABASE_URL points at the real (isolated, but cloud) Audit
 * Supabase project, and this suite must never write E2E fixtures there.
 *
 * Must be imported (for its side effect) BEFORE anything that imports
 * db/audit-index.ts — that module reads AUDIT_DATABASE_URL at module-top-level
 * import time. Static `import "./env"` declared first in a file guarantees
 * this module's body runs before later imports' bodies (ES module
 * evaluation order), without needing top-level await anywhere.
 */
export const E2E_AUDIT_DATABASE_URL = "postgresql://postgres:localtest@localhost:5433/public_map_audit_test";

process.env.AUDIT_DATABASE_URL = E2E_AUDIT_DATABASE_URL;
