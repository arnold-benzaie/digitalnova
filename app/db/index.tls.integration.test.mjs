// 4F.14-X — verified-TLS integration test for db/index.ts's Preview path
// (buildPreviewSslConfig / resolveDatabaseSsl / assertPreviewDatabaseIsolation),
// against REAL Postgres TLS servers — never Supabase.
//
// Uses its OWN three disposable, ephemeral postgres:17 containers (random names +
// ports on 127.0.0.1 only, --rm, destroyed in `after`) and a throwaway CA made
// with openssl in a temp dir that is deleted afterwards:
//   A — server certificate for DNS:localhost, signed by the test CA;
//   B — server certificate for DNS:wrong-name.invalid, signed by the same CA;
//   C — no TLS at all (plaintext only), to prove there is no silent fallback.
// It never touches public-map-approval-test-db, public-map-audit-test-db, the
// Radar validation database, Preview or Production. Every password is random
// and test-only; nothing secret is printed.
//
// Requires a working local Docker and openssl. Run:
//   npx tsx --test db/index.tls.integration.test.mjs
import { test, before, after } from "node:test";
import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { randomBytes } from "node:crypto";
import { mkdtempSync, rmSync, writeFileSync, readFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { setTimeout as sleep } from "node:timers/promises";
import pg from "pg";

delete process.env.VERCEL_ENV;
process.env.DATABASE_URL ??= "postgresql://placeholder-never-dialed/db";
const { assertPreviewDatabaseIsolation, buildPreviewSslConfig, resolveDatabaseSsl } = await import("@/db");

const TMP = mkdtempSync(join(tmpdir(), "pm-db-tls-"));
const PASSWORD = randomBytes(24).toString("base64url");
const servers = {
  A: { name: `pm-db-tls-a-${randomBytes(4).toString("hex")}`, port: 5600 + Math.floor(Math.random() * 40), san: "DNS:localhost" },
  B: { name: `pm-db-tls-b-${randomBytes(4).toString("hex")}`, port: 5640 + Math.floor(Math.random() * 40), san: "DNS:wrong-name.invalid" },
  C: { name: `pm-db-tls-c-${randomBytes(4).toString("hex")}`, port: 5680 + Math.floor(Math.random() * 10), san: null },
};
const sh = (cmd, args) => spawnSync(cmd, args, { encoding: "utf8" });
const openssl = (args) => {
  const r = sh("openssl", args);
  if (r.status !== 0) throw new Error(`openssl a echoue : ${r.stderr.slice(0, 200)}`);
};
const caPem = (file) => readFileSync(join(TMP, file), "utf8");
// Exactly the Preview URL shape the guard accepts: DNS host, no parameter but `options`.
const previewUrl = (port) => `postgresql://bootstrap:${PASSWORD}@localhost:${port}/postgres?options=-c%20search_path%3Dpreview`;

async function connectWith(port, ssl) {
  const client = new pg.Client({ connectionString: previewUrl(port), ssl, connectionTimeoutMillis: 8000 });
  await client.connect();
  return client;
}

before(async () => {
  if (sh("docker", ["info"]).status !== 0) throw new Error("Docker indisponible — demarre Docker et relance. Rien n'a ete cree.");
  const ca = (prefix, cn) => openssl(["req", "-x509", "-newkey", "rsa:2048", "-nodes", "-days", "2", "-subj", `/CN=${cn}`,
    "-keyout", join(TMP, `${prefix}.key`), "-out", join(TMP, `${prefix}.pem`),
    "-addext", "basicConstraints=critical,CA:TRUE", "-addext", "keyUsage=critical,keyCertSign,cRLSign"]);
  ca("ca", "pm-db-tls-test-ca");
  ca("foreign-ca", "pm-db-tls-foreign-ca");
  for (const [id, s] of Object.entries(servers)) {
    if (s.san === null) {
      const plain = sh("docker", ["run", "-d", "--rm", "--name", s.name, "-p", `127.0.0.1:${s.port}:5432`, "-e", "POSTGRES_USER=bootstrap",
        "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "-e", "POSTGRES_DB=postgres", "postgres:17"]);
      if (plain.status !== 0) throw new Error(`docker run a echoue : ${plain.stderr.slice(0, 300)}`);
      continue;
    }
    const dir = join(TMP, id);
    sh("mkdir", ["-p", dir]);
    openssl(["req", "-newkey", "rsa:2048", "-nodes", "-subj", "/CN=pm-db-tls-server", "-keyout", join(dir, "server.key"), "-out", join(dir, "server.csr")]);
    writeFileSync(join(dir, "ext.cnf"), `subjectAltName=${s.san}\nbasicConstraints=CA:FALSE\nextendedKeyUsage=serverAuth\n`);
    openssl(["x509", "-req", "-in", join(dir, "server.csr"), "-CA", join(TMP, "ca.pem"), "-CAkey", join(TMP, "ca.key"), "-CAcreateserial",
      "-days", "2", "-extfile", join(dir, "ext.cnf"), "-out", join(dir, "server.crt")]);
    const boot = "mkdir -p /tls && cp /tls-src/server.crt /tls-src/server.key /tls/ && chown postgres:postgres /tls/* && chmod 600 /tls/server.key && " +
      "exec docker-entrypoint.sh postgres -c ssl=on -c ssl_cert_file=/tls/server.crt -c ssl_key_file=/tls/server.key";
    const run = sh("docker", ["run", "-d", "--rm", "--name", s.name, "-p", `127.0.0.1:${s.port}:5432`, "-e", "POSTGRES_USER=bootstrap",
      "-e", `POSTGRES_PASSWORD=${PASSWORD}`, "-e", "POSTGRES_DB=postgres", "-v", `${dir}:/tls-src:ro`, "--entrypoint", "bash", "postgres:17", "-c", boot]);
    if (run.status !== 0) throw new Error(`docker run a echoue : ${run.stderr.slice(0, 300)}`);
  }
  for (const s of Object.values(servers)) {
    let ok = 0;
    for (let i = 0; i < 90 && ok < 2; i++) {
      await sleep(1000);
      // Readiness probe only: plaintext, no TLS involved (servers accept both).
      const c = new pg.Client({ connectionString: `postgresql://bootstrap:${PASSWORD}@localhost:${s.port}/postgres`, connectionTimeoutMillis: 3000 });
      try { await c.connect(); await c.query("select 1"); ok += 1; } catch { ok = 0; } finally { await c.end().catch(() => {}); }
    }
    if (ok < 2) throw new Error("Postgres jetable jamais pret.");
  }
});

after(() => {
  for (const s of Object.values(servers)) sh("docker", ["rm", "-f", s.name]);
  rmSync(TMP, { recursive: true, force: true });
  for (const s of Object.values(servers)) {
    const left = sh("docker", ["ps", "-a", "--filter", `name=${s.name}`, "--format", "{{.Names}}"]).stdout.trim();
    if (left) console.error(`[db-tls] conteneur ${s.name} encore present — docker rm -f ${s.name}`);
  }
});

test("the URL used here is exactly a guard-accepted Preview URL", () => {
  assert.doesNotThrow(() => assertPreviewDatabaseIsolation(previewUrl(servers.A.port), {}));
});

test("right CA + matching DNS name: verified TLS session, options pass through", async () => {
  const c = await connectWith(servers.A.port, buildPreviewSslConfig(caPem("ca.pem")));
  const { rows: [r] } = await c.query("select ssl, version from pg_stat_ssl where pid = pg_backend_pid()");
  const { rows: [sp] } = await c.query("select current_setting('search_path') sp");
  assert.equal(c.connection.stream.authorized, true);
  assert.equal(r.ssl, true);
  assert.match(r.version, /^TLSv1\.[23]$/);
  assert.equal(sp.sp, "preview");
  await c.end();
});

test("foreign CA: refused during the TLS handshake", async () => {
  await assert.rejects(() => connectWith(servers.A.port, buildPreviewSslConfig(caPem("foreign-ca.pem"))),
    (e) => /SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE|DEPTH_ZERO_SELF_SIGNED_CERT/.test(e.code ?? ""));
});

test("the real Preview config (pinned Supabase Root 2021 CA) refuses a server it did not sign", async () => {
  const ssl = resolveDatabaseSsl({ VERCEL_ENV: "preview" });
  assert.equal(ssl.rejectUnauthorized, true);
  await assert.rejects(() => connectWith(servers.A.port, ssl), (e) => /SELF_SIGNED_CERT_IN_CHAIN|UNABLE_TO_VERIFY_LEAF_SIGNATURE/.test(e.code ?? ""));
});

test("right CA but certificate for another DNS name: refused (host-name verification is real)", async () => {
  await assert.rejects(() => connectWith(servers.B.port, buildPreviewSslConfig(caPem("ca.pem"))), (e) => e.code === "ERR_TLS_CERT_ALTNAME_INVALID");
});

test("no silent plaintext fallback: with the Preview ssl config, a server without TLS is refused, while a plain client still connects", async () => {
  await assert.rejects(() => connectWith(servers.C.port, buildPreviewSslConfig(caPem("ca.pem"))), (e) => /does not support SSL/i.test(e.message));
  const plain = new pg.Client({ connectionString: `postgresql://bootstrap:${PASSWORD}@localhost:${servers.C.port}/postgres`, connectionTimeoutMillis: 8000 });
  await plain.connect();
  const { rows: [r] } = await plain.query("select ssl from pg_stat_ssl where pid = pg_backend_pid()");
  assert.equal(r.ssl, false, "control: the server really accepts plaintext, so the refusal above comes from the client config");
  await plain.end();
});
