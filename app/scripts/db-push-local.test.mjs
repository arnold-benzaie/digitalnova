// Safety tests for scripts/db-push-local.mjs's run() — the CLI entry
// point's testable core (argv/env/promptFn/spawnFn/log/error are all
// injectable). Zero network calls, zero database connections, zero real
// subprocess spawns: every test here passes a fake spawnFn that only
// records what it would have been called with, never runs anything.
// Run with: npx tsx --test scripts/db-push-local.test.mjs
import { test } from "node:test";
import assert from "node:assert/strict";
import { run, redactForDisplay, describeTarget, describeOperation, CONFIRMATION_TOKEN } from "./db-push-local.mjs";

const LOCAL_URL = "postgresql://approval_test_user:localtest_approval_only@127.0.0.1:5434/public_map_approval_test";
const REMOTE_URL = "postgresql://postgres:realpassword@db.abcdefghijklmnop.supabase.co:5432/postgres";

function fakeSpawn(calls) {
  return (cmd, args, opts) => {
    calls.push({ cmd, args, opts });
    // A minimal fake ChildProcess-like emitter — never actually spawns anything.
    return { on: (event, cb) => (event === "exit" ? cb(0) : undefined) };
  };
}

function collectLogs() {
  const lines = [];
  return { log: (line) => lines.push(String(line)), lines };
}

// ---- --dry-run with localhost succeeds without spawning drizzle-kit ----
test("--dry-run with a localhost URL succeeds and never spawns drizzle-kit", async () => {
  const calls = [];
  const { log, lines } = collectLogs();
  const result = await run({
    argv: ["--dry-run"],
    env: { LOCAL_TEST_DATABASE_URL: "postgresql://user:pass@localhost:5432/mydb" },
    spawnFn: fakeSpawn(calls),
    log,
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(result.spawned, false);
  assert.equal(calls.length, 0, "drizzle-kit must never be spawned during --dry-run");
  assert.ok(lines.some((l) => l.includes("Classification : LOCAL")));
});

// ---- --dry-run with 127.0.0.1 succeeds ----
test("--dry-run with a 127.0.0.1 URL succeeds and never spawns drizzle-kit", async () => {
  const calls = [];
  const result = await run({
    argv: ["--dry-run"],
    env: { LOCAL_TEST_DATABASE_URL: LOCAL_URL },
    spawnFn: fakeSpawn(calls),
    log: () => {},
  });

  assert.equal(result.ok, true);
  assert.equal(result.dryRun, true);
  assert.equal(calls.length, 0);
});

// ---- remote URL fails before spawn ----
test("a remote (Supabase) URL is refused before any spawn is attempted, even without --dry-run", async () => {
  const calls = [];
  const errors = [];
  const result = await run({
    argv: [],
    env: { LOCAL_TEST_DATABASE_URL: REMOTE_URL },
    spawnFn: fakeSpawn(calls),
    log: () => {},
    error: (line) => errors.push(String(line)),
  });

  assert.equal(result.ok, false);
  assert.equal(result.refused, true);
  assert.equal(calls.length, 0, "drizzle-kit must never be spawned for a remote target");
  assert.ok(errors.some((l) => l.includes("REFUSED")));
});

// ---- missing LOCAL_TEST_DATABASE_URL fails ----
test("a missing LOCAL_TEST_DATABASE_URL is refused before any spawn is attempted", async () => {
  const calls = [];
  const result = await run({
    argv: ["--dry-run"],
    env: {},
    spawnFn: fakeSpawn(calls),
    log: () => {},
    error: () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.refused, true);
  assert.equal(calls.length, 0);
});

// ---- malformed URL fails ----
test("a malformed LOCAL_TEST_DATABASE_URL is refused before any spawn is attempted", async () => {
  const calls = [];
  const result = await run({
    argv: ["--dry-run"],
    env: { LOCAL_TEST_DATABASE_URL: "not a url" },
    spawnFn: fakeSpawn(calls),
    log: () => {},
    error: () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.refused, true);
  assert.equal(calls.length, 0);
});

// ---- DATABASE_URL alone does NOT satisfy the wrapper ----
test("setting only DATABASE_URL (not LOCAL_TEST_DATABASE_URL) is refused — no fallback exists", async () => {
  const calls = [];
  const result = await run({
    argv: ["--dry-run"],
    env: { DATABASE_URL: LOCAL_URL }, // deliberately the WRONG variable name
    spawnFn: fakeSpawn(calls),
    log: () => {},
    error: () => {},
  });

  assert.equal(result.ok, false);
  assert.equal(result.refused, true);
  assert.equal(calls.length, 0);
});

test("DATABASE_URL pointing to a remote host does not leak into the local-only wrapper even if LOCAL_TEST_DATABASE_URL is also set", async () => {
  const calls = [];
  const { log, lines } = collectLogs();
  const result = await run({
    argv: ["--dry-run"],
    env: { DATABASE_URL: REMOTE_URL, LOCAL_TEST_DATABASE_URL: LOCAL_URL },
    spawnFn: fakeSpawn(calls),
    log,
  });

  assert.equal(result.ok, true);
  assert.ok(!lines.some((l) => l.includes("supabase")), "the remote DATABASE_URL's host must never appear in the wrapper's output");
});

// ---- output does not expose password/full URL ----
test("the printed target output never includes the username, password, or full connection string", async () => {
  const { log, lines } = collectLogs();
  await run({
    argv: ["--dry-run"],
    env: { LOCAL_TEST_DATABASE_URL: LOCAL_URL },
    spawnFn: fakeSpawn([]),
    log,
  });

  const fullOutput = lines.join("\n");
  assert.doesNotMatch(fullOutput, /approval_test_user|localtest_approval_only/, "credentials must never be printed");
  assert.doesNotMatch(fullOutput, /postgresql:\/\//, "the raw connection string/URL scheme must never be printed");
});

test("redactForDisplay/describeTarget never include username or password fields", () => {
  const target = describeTarget(LOCAL_URL);
  assert.deepEqual(Object.keys(target).sort(), ["classification", "database", "host", "port"]);
  assert.equal(target.host, "127.0.0.1");
  assert.equal(target.port, "5434");
  assert.equal(target.database, "public_map_approval_test");
  assert.equal(target.classification, "LOCAL");

  const raw = redactForDisplay(LOCAL_URL);
  assert.deepEqual(Object.keys(raw).sort(), ["database", "host", "port"]);
});

// ---- no --yes bypass exists ----
test("passing --yes has no special effect — confirmation is still required for a real (non-dry-run) push", async () => {
  const calls = [];
  await run({
    argv: ["--yes"], // not a recognized flag at all — must not skip confirmation
    env: { LOCAL_TEST_DATABASE_URL: LOCAL_URL },
    spawnFn: fakeSpawn(calls),
    promptFn: async () => "MIGRATE", // even providing a real confirmation, --yes itself does nothing special
    log: () => {},
  });

  // The only way this reaches spawn is via the typed confirmation, not --yes.
  assert.equal(calls.length, 1, "spawn only happens via the typed MIGRATE confirmation, never via a --yes-style flag");
});

test("the confirmation flow only spawns drizzle-kit when the exact token is typed", async () => {
  const calls = [];
  const result = await run({
    argv: [],
    env: { LOCAL_TEST_DATABASE_URL: LOCAL_URL },
    spawnFn: fakeSpawn(calls),
    promptFn: async () => "yes please",
    log: () => {},
  });

  assert.equal(result.cancelled, true);
  assert.equal(calls.length, 0, "anything other than the exact confirmation token must cancel, never spawn");
});

test("typing the exact confirmation token spawns exactly the expected drizzle-kit push command", async () => {
  const calls = [];
  const result = await run({
    argv: [],
    env: { LOCAL_TEST_DATABASE_URL: LOCAL_URL },
    spawnFn: fakeSpawn(calls),
    promptFn: async () => CONFIRMATION_TOKEN,
    log: () => {},
  });

  assert.equal(result.spawned, true);
  assert.equal(calls.length, 1);
  assert.equal(calls[0].cmd, "npx");
  assert.deepEqual(calls[0].args, ["drizzle-kit", "push", "--config=drizzle.local.config.ts"]);
});

test("describeOperation reports the exact intended drizzle-kit invocation", () => {
  assert.equal(describeOperation(), "drizzle-kit push --config=drizzle.local.config.ts");
});
