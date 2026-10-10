// Unit tests for db/index.ts's resolveDatabaseUrl() — the fallback logic
// letting one Vercel Preview branch (via a branch-scoped
// PREVIEW_SCHEMA_DATABASE_URL) opt into the preview-schema sandbox for a
// real deployment, without touching what Production or any other Preview
// branch reads.
//
// No database connection: resolveDatabaseUrl() is a pure function of
// process.env. Importing "@/db" once at the top (required to reach it)
// does construct a real `pg` Pool at module load, but node-postgres never
// opens a socket until a query actually runs — so a syntactically-valid,
// never-dialed placeholder connection string is safe here. Every value
// used below is a placeholder, never a real credential.
//
// 4F.14-O — on VERCEL_ENV=preview the selection now fails closed: no
// fallback to DATABASE_URL, and PREVIEW_SCHEMA_DATABASE_URL must pin
// search_path to exactly `preview` through its `options` parameter.
//
// Run with: npx tsx --test db/index.test.mjs
import { test, after } from "node:test";
import assert from "node:assert/strict";
import pg from "pg";
import { X509Certificate } from "node:crypto";

const ORIGINAL_ENV = { ...process.env };
delete process.env.VERCEL_ENV;
delete process.env.PGOPTIONS;
process.env.DATABASE_URL = "postgresql://placeholder-never-dialed/db";

const { PREVIEW_ISOLATION_OPTIONS, PreviewDatabaseIsolationError, assertPreviewDatabaseIsolation, buildPreviewSslConfig, resolveDatabaseSsl, resolveDatabaseUrl } = await import("@/db");
const { SUPABASE_ROOT_CA_2021_PEM, SUPABASE_ROOT_CA_2021_SHA256 } = await import("@/db/supabase-root-ca");

// Placeholder only — never dialed, never a real credential.
const ISOLATED_PREVIEW_URL = "postgresql://placeholder-preview-schema/db?options=-c%20search_path%3Dpreview";

function resetEnv() {
  delete process.env.VERCEL_ENV;
  delete process.env.PREVIEW_SCHEMA_DATABASE_URL;
  delete process.env.DATABASE_URL;
  delete process.env.PGOPTIONS;
}

const isIsolationError = (err) => err instanceof PreviewDatabaseIsolationError && !/placeholder/.test(err.message);

after(() => {
  // Restore exactly what was there before this file ran anything.
  resetEnv();
  Object.assign(process.env, ORIGINAL_ENV);
});

test("production + both variables set: DATABASE_URL is chosen", () => {
  resetEnv();
  process.env.VERCEL_ENV = "production";
  process.env.DATABASE_URL = "postgresql://placeholder-production/db";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-production/db");
});

test("preview + an isolated PREVIEW_SCHEMA_DATABASE_URL: the Preview URL is chosen", () => {
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.DATABASE_URL = "postgresql://placeholder-shared-preview/db";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = ISOLATED_PREVIEW_URL;
  assert.equal(resolveDatabaseUrl(), ISOLATED_PREVIEW_URL);
});

test("preview + PREVIEW_SCHEMA_DATABASE_URL absent: refused, never a fallback to DATABASE_URL", () => {
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.DATABASE_URL = "postgresql://placeholder-shared-preview/db";
  assert.throws(() => resolveDatabaseUrl(), isIsolationError);
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "";
  assert.throws(() => resolveDatabaseUrl(), isIsolationError);
});

test("local/non-Vercel (VERCEL_ENV unset): DATABASE_URL is chosen even if PREVIEW_SCHEMA_DATABASE_URL is set", () => {
  resetEnv();
  process.env.DATABASE_URL = "postgresql://placeholder-local/db";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-local/db");
});

test("VERCEL_ENV=development (Vercel's own local/dev value): DATABASE_URL is chosen, never the Preview URL", () => {
  resetEnv();
  process.env.VERCEL_ENV = "development";
  process.env.DATABASE_URL = "postgresql://placeholder-local/db";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-local/db");
});

test("no URL available at all: resolves to undefined (the caller in db/index.ts throws on this)", () => {
  resetEnv();
  assert.equal(resolveDatabaseUrl(), undefined);
});

test("preview + only an isolated PREVIEW_SCHEMA_DATABASE_URL set (no DATABASE_URL): the Preview URL is chosen", () => {
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = ISOLATED_PREVIEW_URL;
  assert.equal(resolveDatabaseUrl(), ISOLATED_PREVIEW_URL);
});

test("preview: a Preview URL without any `options` parameter is refused", () => {
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
  assert.throws(() => resolveDatabaseUrl(), isIsolationError);
});

test("preview: any search_path other than exactly `preview` is refused", () => {
  const base = "postgresql://placeholder-preview-schema/db?options=";
  for (const options of [
    "-c search_path=preview,public",
    "-c search_path=public",
    "-c search_path=\"$user\",preview",
    "-c search_path=public,preview",
    "-c search_path=",
    "-c search_path=preview -c search_path=public",
    "-c search_path=preview -c statement_timeout=0",
  ]) {
    assert.throws(() => assertPreviewDatabaseIsolation(base + encodeURIComponent(options), {}), isIsolationError, options);
  }
});

test("preview: malformed or ambiguous `options` are refused", () => {
  const base = "postgresql://placeholder-preview-schema/db";
  for (const suffix of [
    "?options=-c%20search_path%3Dpreview&options=-c%20search_path%3Dpublic", // duplicate: pg keeps the LAST one
    "?options=-c%20search_path%3Dpreview&options=-c%20search_path%3Dpreview", // duplicate, even if identical
    "?options=-c%2520search_path%253Dpreview", // double-encoded
    "?options=-csearch_path%3Dpreview",
    "?options=--search_path%3Dpreview",
    "?options=-c%20search_path%3D%27preview%27",
    "?options=%20-c%20search_path%3Dpreview",
    "?options=-c%20search_path%3Dpreview%20",
    "?options=-c%20SEARCH_PATH%3Dpreview",
  ]) {
    assert.throws(() => assertPreviewDatabaseIsolation(base + suffix, {}), isIsolationError, suffix);
  }
  assert.throws(() => assertPreviewDatabaseIsolation("not a url", {}), isIsolationError);
});

test("preview: PGOPTIONS set (even empty) is refused, even with an otherwise isolated URL", () => {
  for (const value of ["-c search_path=public", "-c search_path=preview", ""]) {
    assert.throws(() => assertPreviewDatabaseIsolation(ISOLATED_PREVIEW_URL, { PGOPTIONS: value }), isIsolationError, value);
  }
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = ISOLATED_PREVIEW_URL;
  process.env.PGOPTIONS = "-c search_path=public";
  assert.throws(() => resolveDatabaseUrl(), isIsolationError);
});

test("pg itself sends exactly the accepted value: URL `options` win over the config object and over PGOPTIONS", () => {
  // No connect(): building a Client only resolves its connection parameters.
  const fromUrl = new pg.Client({ connectionString: ISOLATED_PREVIEW_URL, options: "-c search_path=public" });
  assert.equal(fromUrl.connectionParameters.options, PREVIEW_ISOLATION_OPTIONS);
  const plusEncoded = "postgresql://placeholder-preview-schema/db?options=-c+search_path%3Dpreview";
  assert.doesNotThrow(() => assertPreviewDatabaseIsolation(plusEncoded, {}));
  assert.equal(new pg.Client({ connectionString: plusEncoded }).connectionParameters.options, PREVIEW_ISOLATION_OPTIONS);
  const duplicated = "postgresql://placeholder-preview-schema/db?options=-c%20search_path%3Dpreview&options=-c%20search_path%3Dpublic";
  assert.equal(new pg.Client({ connectionString: duplicated }).connectionParameters.options, "-c search_path=public", "why duplicates must be refused");
  process.env.PGOPTIONS = "-c search_path=public";
  try {
    assert.equal(new pg.Client({ connectionString: "postgresql://placeholder-preview-schema/db" }).connectionParameters.options, "-c search_path=public", "why PGOPTIONS must be refused");
  } finally {
    delete process.env.PGOPTIONS;
  }
});

test("production and local ignore the Preview guard entirely (PGOPTIONS and a non-isolated Preview URL included)", () => {
  for (const vercelEnv of ["production", undefined, "development"]) {
    resetEnv();
    if (vercelEnv) process.env.VERCEL_ENV = vercelEnv;
    process.env.DATABASE_URL = "postgresql://placeholder-main/db";
    process.env.PREVIEW_SCHEMA_DATABASE_URL = "postgresql://placeholder-preview-schema/db";
    process.env.PGOPTIONS = "-c search_path=public";
    assert.equal(resolveDatabaseUrl(), "postgresql://placeholder-main/db", String(vercelEnv));
  }
});

// ---- 4F.14-X — verified TLS on Preview -------------------------------------

// Fingerprint verified in 4F.14-V against the certificate downloaded from the
// Supabase dashboard and the live pooler chain. Changing the PEM must change this.
const EXPECTED_SUPABASE_ROOT_CA_SHA256 = "80:70:25:AD:50:D4:ED:21:9D:2C:9C:7D:29:9C:00:4F:82:4E:B0:0C:F7:F6:5A:FE:F6:07:D0:7B:72:E6:CA:FA";

test("pinned Supabase Root 2021 CA: exact SHA-256, a CA, the expected subject, valid for at least 180 more days", () => {
  const cert = new X509Certificate(SUPABASE_ROOT_CA_2021_PEM);
  assert.equal(cert.fingerprint256, EXPECTED_SUPABASE_ROOT_CA_SHA256);
  assert.equal(SUPABASE_ROOT_CA_2021_SHA256, EXPECTED_SUPABASE_ROOT_CA_SHA256);
  assert.equal(cert.ca, true);
  assert.match(cert.subject, /CN=Supabase Root 2021 CA/);
  assert.equal(cert.subject, cert.issuer, "self-signed root");
  assert.ok(new Date(cert.validTo).getTime() - Date.now() > 180 * 24 * 3600 * 1000, "renew the pinned CA before it expires");
  assert.equal((SUPABASE_ROOT_CA_2021_PEM.match(/-----BEGIN CERTIFICATE-----/g) ?? []).length, 1);
  assert.doesNotMatch(SUPABASE_ROOT_CA_2021_PEM, /PRIVATE KEY/);
});

test("resolveDatabaseSsl: Preview gets the pinned CA with rejectUnauthorized; production, development and local get undefined", () => {
  assert.deepEqual(resolveDatabaseSsl({ VERCEL_ENV: "preview" }), { ca: SUPABASE_ROOT_CA_2021_PEM, rejectUnauthorized: true });
  for (const env of [{ VERCEL_ENV: "production" }, { VERCEL_ENV: "development" }, {}]) assert.equal(resolveDatabaseSsl(env), undefined);
  assert.deepEqual(buildPreviewSslConfig("TEST-CA"), { ca: "TEST-CA", rejectUnauthorized: true });
});

test("preview: every TLS-related URL parameter is refused (they would replace the code's ssl config)", () => {
  for (const param of ["sslmode=verify-full", "sslmode=require", "sslmode=disable", "sslmode=no-verify", "sslrootcert=%2Ftmp%2Fca.pem",
    "sslcert=%2Ftmp%2Fc.pem", "sslkey=%2Ftmp%2Fk.pem", "ssl=true", "ssl=0", "sslnegotiation=direct", "uselibpqcompat=true"]) {
    assert.throws(() => assertPreviewDatabaseIsolation(`${ISOLATED_PREVIEW_URL}&${param}`, {}), isIsolationError, param);
  }
});

test("preview: query parameters that override host/port/user/database are refused, and so is any other parameter", () => {
  for (const param of ["host=1.2.3.4", "host=evil.example.com", "port=6543", "user=postgres", "password=x", "db=other", "application_name=x"]) {
    assert.throws(() => assertPreviewDatabaseIsolation(`${ISOLATED_PREVIEW_URL}&${param}`, {}), isIsolationError, param);
  }
});

test("preview: IP hosts, a missing host and non-postgres schemes are refused", () => {
  for (const url of [
    "postgresql://u:p@127.0.0.1:5432/postgres?options=-c%20search_path%3Dpreview",
    "postgresql://u:p@10.1.2.3:5432/postgres?options=-c%20search_path%3Dpreview",
    "postgresql://u:p@[::1]:5432/postgres?options=-c%20search_path%3Dpreview",
    "postgresql://u:p@/postgres?options=-c%20search_path%3Dpreview",
    "socket://u:p@%2Ftmp/postgres?options=-c%20search_path%3Dpreview",
    "http://u:p@placeholder-preview-schema/postgres?options=-c%20search_path%3Dpreview",
  ]) {
    assert.throws(() => assertPreviewDatabaseIsolation(url, {}), (err) => err instanceof PreviewDatabaseIsolationError && !err.message.includes("u:p@"), url);
  }
  assert.doesNotThrow(() => assertPreviewDatabaseIsolation("postgres://u:p@aws-0-eu-west-3.pooler.supabase.com:5432/postgres?options=-c%20search_path%3Dpreview", {}));
});

test("preview: PGSSLMODE or PGSSLROOTCERT in the environment is refused (pg reads PGSSLMODE when no ssl is given)", () => {
  for (const env of [{ PGSSLMODE: "verify-full" }, { PGSSLMODE: "require" }, { PGSSLMODE: "disable" }, { PGSSLMODE: "" }, { PGSSLROOTCERT: "/tmp/ca.pem" }]) {
    assert.throws(() => assertPreviewDatabaseIsolation(ISOLATED_PREVIEW_URL, env), isIsolationError, JSON.stringify(Object.keys(env)));
  }
  resetEnv();
  process.env.VERCEL_ENV = "preview";
  process.env.PREVIEW_SCHEMA_DATABASE_URL = ISOLATED_PREVIEW_URL;
  process.env.PGSSLMODE = "disable";
  try {
    assert.throws(() => resolveDatabaseUrl(), isIsolationError);
  } finally {
    delete process.env.PGSSLMODE;
  }
});

test("pg keeps the code's ssl only for a parameter-free URL — and why the guard refuses the rest", () => {
  // No connect(): building a Client only resolves its connection parameters.
  const ssl = buildPreviewSslConfig("TEST-CA");
  const kept = new pg.Client({ connectionString: ISOLATED_PREVIEW_URL, ssl }).connectionParameters;
  assert.deepEqual({ ca: kept.ssl.ca, rejectUnauthorized: kept.ssl.rejectUnauthorized }, { ca: "TEST-CA", rejectUnauthorized: true });
  assert.equal(kept.host, "placeholder-preview-schema");
  const replaced = new pg.Client({ connectionString: `${ISOLATED_PREVIEW_URL}&sslmode=verify-full`, ssl }).connectionParameters;
  assert.equal(replaced.ssl.ca, undefined, "sslmode in the URL drops the pinned CA");
  const hostOverride = new pg.Client({ connectionString: `${ISOLATED_PREVIEW_URL}&host=1.2.3.4`, ssl }).connectionParameters;
  assert.equal(hostOverride.host, "1.2.3.4", "?host= overrides the URL host");
});

test("production/local pool config is unchanged: ssl undefined resolves exactly like no ssl key at all", () => {
  const url = "postgresql://placeholder-main/db";
  assert.deepEqual(new pg.Client({ connectionString: url, ssl: resolveDatabaseSsl({ VERCEL_ENV: "production" }) }).connectionParameters.ssl,
    new pg.Client({ connectionString: url }).connectionParameters.ssl);
});
