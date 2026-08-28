// Pure unit tests for db/guard-local-only.ts's assertLocalOnlyDatabase().
// Zero network calls, zero database connections — string/URL parsing only.
// Run with: npx tsx --test db/guard-local-only.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { assertLocalOnlyDatabase, LocalOnlyDatabaseGuardError } from "./guard-local-only.ts";

const ENV_VAR = "LOCAL_TEST_DATABASE_URL";

function accepts(url) {
  assert.doesNotThrow(() => assertLocalOnlyDatabase(url, ENV_VAR));
}

function rejects(url) {
  assert.throws(() => assertLocalOnlyDatabase(url, ENV_VAR), LocalOnlyDatabaseGuardError);
}

// ---- 1. localhost accepted ----
test("localhost is accepted", () => {
  accepts("postgresql://user:pass@localhost:5432/mydb");
});

// ---- 2. 127.0.0.1 accepted ----
test("127.0.0.1 is accepted", () => {
  accepts("postgresql://user:pass@127.0.0.1:5432/mydb");
});

// ---- 3. established disposable local DB URL accepted ----
test("the repo's own established disposable local test DB URL is accepted", () => {
  accepts("postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test");
});

// ---- 4. Supabase rejected ----
test("a Supabase host is rejected", () => {
  rejects("postgresql://postgres:pass@db.abcdefghijklmnop.supabase.co:5432/postgres");
});

// ---- 5. Neon rejected ----
test("a Neon host is rejected", () => {
  rejects("postgresql://user:pass@ep-cool-name-123456.us-east-2.aws.neon.tech/mydb");
});

// ---- 6. pooler rejected ----
test("a Supabase pooler host is rejected", () => {
  rejects("postgresql://postgres.xxxx:pass@aws-0-eu-west-3.pooler.supabase.com:6543/postgres");
});

// ---- 7. arbitrary remote hostname rejected ----
test("an arbitrary, unrecognized remote hostname is rejected (allowlist, not a provider denylist)", () => {
  rejects("postgresql://user:pass@some-random-host.example.com:5432/mydb");
});

test("a private-looking but non-approved hostname is rejected", () => {
  rejects("postgresql://user:pass@db.internal.example.net:5432/mydb");
});

test("a hostname that merely contains 'localhost' as a substring is rejected (exact match only)", () => {
  rejects("postgresql://user:pass@notlocalhost.example.com:5432/mydb");
  rejects("postgresql://user:pass@localhost.evil.example.com:5432/mydb");
});

// ---- deceptive hosts (Phase S2 final review, §3/§9) — exact allowlist
// equality only, never a substring/prefix/suffix check ----
test("a hostname ending in 'localhost' but not equal to it is rejected — localhost.example.com", () => {
  rejects("postgresql://user:pass@localhost.example.com:5432/mydb");
});

test("a hostname starting with 'localhost' but not equal to it is rejected — example.localhost", () => {
  rejects("postgresql://user:pass@example.localhost:5432/mydb");
});

test("a hostname starting with '127.0.0.' but not equal to 127.0.0.1 is rejected — 127.0.0.2", () => {
  rejects("postgresql://user:pass@127.0.0.2:5432/mydb");
});

test("a hostname starting with '127.' but not equal to 127.0.0.1 is rejected — 127.1.2.3", () => {
  rejects("postgresql://user:pass@127.1.2.3:5432/mydb");
});

test("a hostname prefixed with the exact allowed IP but not equal to it is rejected — 127.0.0.1.example.com", () => {
  rejects("postgresql://user:pass@127.0.0.1.example.com:5432/mydb");
});

// ---- 8/9. missing / empty rejected ----
test("an undefined connection string is rejected", () => {
  rejects(undefined);
});

test("an empty string connection string is rejected", () => {
  rejects("");
});

test("a whitespace-only connection string is rejected", () => {
  rejects("   ");
});

// ---- 10. malformed URL rejected ----
test("a malformed, unparseable URL is rejected", () => {
  rejects("not a url at all");
  rejects("postgresql://");
  rejects("localhost:5432");
});

// ---- 11. localhost with normal PostgreSQL port accepted ----
test("localhost with the standard PostgreSQL port 5432 is accepted", () => {
  accepts("postgresql://user:pass@localhost:5432/mydb");
});

// ---- 12. 127.0.0.1 with custom local port accepted ----
test("127.0.0.1 with a non-standard local Docker port is accepted", () => {
  accepts("postgresql://user:pass@127.0.0.1:5434/mydb");
  accepts("postgresql://user:pass@127.0.0.1:54329/mydb");
});

// ---- 13. IPv6 loopback deliberately NOT supported ----
test("IPv6 loopback (::1) is rejected — deliberately not on the allowlist, no established convention for it in this repo", () => {
  rejects("postgresql://user:pass@[::1]:5432/mydb");
});

// ---- error message safety ----
test("the thrown error message never includes the raw connection string (which may carry credentials)", () => {
  const secretLookingUrl = "postgresql://realuser:realpassword123@evil-remote-host.example.com:5432/proddb";
  try {
    assertLocalOnlyDatabase(secretLookingUrl, ENV_VAR);
    assert.fail("expected assertLocalOnlyDatabase to throw");
  } catch (err) {
    assert.ok(err instanceof LocalOnlyDatabaseGuardError);
    assert.doesNotMatch(err.message, /realuser|realpassword123|evil-remote-host/i, "error message must never echo back the connection string contents");
  }
});

test("the env var name is included in the error message to make it actionable", () => {
  try {
    assertLocalOnlyDatabase(undefined, "LOCAL_TEST_DATABASE_URL");
    assert.fail("expected assertLocalOnlyDatabase to throw");
  } catch (err) {
    assert.match(err.message, /LOCAL_TEST_DATABASE_URL/);
  }
});
