// Shared DB fixture helpers for the Google Ads E2E suite — plain .mjs
// (not .ts) so it can be imported both from the *.spec.ts files (via
// Playwright's TS loader) and run standalone if needed. Talks directly to
// the same fully isolated local Docker Postgres the dev server itself
// uses in this config (public-map-approval-test-db, port 5434) — never
// Supabase Production/Preview.
import { randomUUID, createCipheriv, randomBytes } from "node:crypto";
import { Client } from "pg";

export const LOCAL_DB_URL = "postgresql://approval_test_user:localtest_approval_only@localhost:5434/public_map_approval_test";
if (/supabase\.com/i.test(LOCAL_DB_URL)) {
  throw new Error("REFUS : LOCAL_DB_URL ressemble à Supabase Production.");
}

// Must be byte-for-byte the same key playwright.google-ads.config.ts gives
// the dev server (GOOGLE_ADS_API_BASE_URL... no — INTEGRATION_SECRET_ENCRYPTION_KEY)
// so a refresh token this script encrypts is decryptable by the running
// app. See that config file's own comment on E2E_GOOGLE_ADS_ENCRYPTION_KEY.
const ENCRYPTION_KEY = Buffer.from("lbIAH/cC16uAwexqs/HmjuRdcP652wLahLLidUHT+8Y=", "base64");

function encryptFixtureRefreshToken(plaintext, organizationId) {
  const iv = randomBytes(12);
  const cipher = createCipheriv("aes-256-gcm", ENCRYPTION_KEY, iv);
  cipher.setAAD(Buffer.from(`google-ads-refresh-token:${organizationId}`, "utf8"));
  const ciphertext = Buffer.concat([cipher.update(plaintext, "utf8"), cipher.final()]);
  return { ciphertext: ciphertext.toString("base64"), iv: iv.toString("base64"), authTag: cipher.getAuthTag().toString("base64") };
}

/** @template T
 * @param {(db: import("pg").Client) => Promise<T>} fn
 * @returns {Promise<T>} */
export async function withDb(fn) {
  const db = new Client({ connectionString: LOCAL_DB_URL });
  await db.connect();
  try {
    return await fn(db);
  } finally {
    await db.end();
  }
}

/** @param {import("pg").Client} db @param {string} name */
async function roleId(db, name) {
  const { rows } = await db.query('select id from roles where name = $1 limit 1', [name]);
  if (!rows[0]) throw new Error(`Rôle "${name}" introuvable.`);
  return rows[0].id;
}

/** Creates an org + a client-role user (DB rows only — the Clerk account
 * is created separately, by the spec file, and linked via clerkUserId).
 * @param {import("pg").Client} db @param {string} clerkUserId @param {string} email */
export async function createOrgAndClientUser(db, clerkUserId, email) {
  const { rows: orgRows } = await db.query('insert into organizations (name) values ($1) returning *', [`E2E Google Ads Org ${randomUUID()}`]);
  const org = orgRows[0];
  const { rows: userRows } = await db.query(
    'insert into users (clerk_user_id, email, full_name, status) values ($1, $2, $3, $4) returning *',
    [clerkUserId, email, "E2E Google Ads Client", "active"],
  );
  const user = userRows[0];
  await db.query('insert into memberships (user_id, organization_id, role_id) values ($1, $2, $3)', [user.id, org.id, await roleId(db, "client")]);
  return { org, user };
}

/** Seeds a `google_ads_connections` row directly — bypasses the real
 * OAuth dance entirely (Playwright cannot drive Google's real consent
 * screen), representing "already connected". `customerId: null` (the
 * default) means "connected, no account selected yet". The access token
 * is seeded far in the future (not just long enough for one Playwright
 * run) because this same helper is reused for long-lived manual/local QA
 * sessions — a short TTL previously caused a real token-refresh attempt
 * against Google's OAuth endpoint hours later, which fails with fake
 * local credentials and looks like an application bug (see the Google
 * Ads Étape 3 follow-up report).
 * @param {import("pg").Client} db
 * @param {{ organizationId: string, connectedByUserId: string, customerId?: string | null, loginCustomerId?: string | null }} opts */
export async function seedGoogleAdsConnection(db, { organizationId, connectedByUserId, customerId = null, loginCustomerId = null }) {
  const encrypted = encryptFixtureRefreshToken("1//e2e-fixture-refresh-token", organizationId);
  await db.query(
    `insert into google_ads_connections
      (organization_id, connected_by_user_id, google_account_email, access_token, access_token_expires_at,
       refresh_token_ciphertext, refresh_token_iv, refresh_token_auth_tag, granted_scopes, customer_id, login_customer_id,
       customer_descriptive_name, customer_currency_code, customer_time_zone)
     values ($1, $2, $3, $4, now() + interval '3650 days', $5, $6, $7, $8, $9, $10, $11, $12, $13)`,
    [
      organizationId,
      connectedByUserId,
      "e2e-fixture@example.com",
      "e2e-fixture-access-token",
      encrypted.ciphertext,
      encrypted.iv,
      encrypted.authTag,
      JSON.stringify(["https://www.googleapis.com/auth/adwords"]),
      customerId,
      loginCustomerId,
      customerId ? "Compte fixture E2E" : null,
      customerId ? "EUR" : null,
      customerId ? "Europe/Paris" : null,
    ],
  );
}

/** @param {import("pg").Client} db @param {string} organizationId */
export async function cleanupOrg(db, organizationId) {
  // Capture member user ids BEFORE deleting the org — deleting it cascades
  // memberships/google_ads_connections (both organizationId onDelete:
  // cascade) but users themselves aren't org-owned, so they're deleted
  // separately, afterwards.
  const { rows } = await db.query('select user_id from memberships where organization_id = $1', [organizationId]);
  await db.query('delete from organizations where id = $1', [organizationId]);
  for (const { user_id } of rows) {
    await db.query('delete from users where id = $1', [user_id]);
  }
}
