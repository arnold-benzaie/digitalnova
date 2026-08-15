// Pure unit tests for Google Ads OAuth URL construction and config
// detection — no network, no DB. googleapis's OAuth2Client.generateAuthUrl()
// builds a URL purely from local state, so this is safe to call directly.
// Run with: npx tsx --test --experimental-test-module-mocks lib/google-ads/oauth.test.mjs
import { test, mock } from "node:test";
import assert from "node:assert/strict";

mock.module("server-only", { namedExports: {} });

function withEnv(vars, fn) {
  const previous = {};
  for (const key of Object.keys(vars)) previous[key] = process.env[key];
  Object.assign(process.env, vars);
  try {
    return fn();
  } finally {
    for (const key of Object.keys(vars)) {
      if (previous[key] === undefined) delete process.env[key];
      else process.env[key] = previous[key];
    }
  }
}

const { isGoogleAdsOAuthConfigured, createGoogleAdsOAuthClient, buildGoogleAdsAuthUrl, GOOGLE_ADS_SCOPE, GOOGLE_ADS_USERINFO_EMAIL_SCOPE } =
  await import("./oauth.ts");

test("GOOGLE_ADS_SCOPE is exactly the official adwords scope, nothing broader", () => {
  assert.equal(GOOGLE_ADS_SCOPE, "https://www.googleapis.com/auth/adwords");
});

test("GOOGLE_ADS_USERINFO_EMAIL_SCOPE is exactly the minimal userinfo.email scope, nothing broader", () => {
  assert.equal(GOOGLE_ADS_USERINFO_EMAIL_SCOPE, "https://www.googleapis.com/auth/userinfo.email");
});

test("isGoogleAdsOAuthConfigured: false when any of the 3 required env vars is missing", () => {
  withEnv({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_ADS_DEVELOPER_TOKEN: "" }, () => {
    assert.equal(isGoogleAdsOAuthConfigured(), false);
  });
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_ADS_DEVELOPER_TOKEN: "" }, () => {
    assert.equal(isGoogleAdsOAuthConfigured(), false, "missing developer token alone must still be reported as not configured");
  });
});

test("isGoogleAdsOAuthConfigured: true only when all 3 are set", () => {
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_ADS_DEVELOPER_TOKEN: "token" }, () => {
    assert.equal(isGoogleAdsOAuthConfigured(), true);
  });
});

test("createGoogleAdsOAuthClient throws a clear error rather than constructing a broken client when not configured", () => {
  withEnv({ GOOGLE_CLIENT_ID: "", GOOGLE_CLIENT_SECRET: "", GOOGLE_ADS_DEVELOPER_TOKEN: "" }, () => {
    assert.throws(() => createGoogleAdsOAuthClient(), /pas configuré/);
  });
});

test("buildGoogleAdsAuthUrl: requests exactly adwords + userinfo.email — never GBP/Analytics/Search Console scopes, never profile/openid", () => {
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_ADS_DEVELOPER_TOKEN: "token" }, () => {
    const url = new URL(buildGoogleAdsAuthUrl("some-state"));
    const scope = url.searchParams.get("scope");
    // exchangeGoogleAdsCode() calls oauth2.userinfo.get() to resolve the
    // connected account's email (googleAdsConnections.googleAccountEmail
    // is NOT NULL) — adwords alone doesn't grant access to that endpoint
    // (confirmed: Google returns 401 UNAUTHENTICATED without this scope).
    assert.equal(scope, `${GOOGLE_ADS_SCOPE} ${GOOGLE_ADS_USERINFO_EMAIL_SCOPE}`);
    assert.equal(scope.split(" ").length, 2, "exactly these 2 scopes, nothing else requested");
  });
});

test("buildGoogleAdsAuthUrl: offline access + forced consent (refresh_token guaranteed even on repeat consent)", () => {
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_ADS_DEVELOPER_TOKEN: "token" }, () => {
    const url = new URL(buildGoogleAdsAuthUrl("some-state"));
    assert.equal(url.searchParams.get("access_type"), "offline");
    assert.equal(url.searchParams.get("prompt"), "consent");
  });
});

test("buildGoogleAdsAuthUrl: state passes through byte-for-byte", () => {
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "secret", GOOGLE_ADS_DEVELOPER_TOKEN: "token" }, () => {
    const url = new URL(buildGoogleAdsAuthUrl("abc123.state-value"));
    assert.equal(url.searchParams.get("state"), "abc123.state-value");
  });
});

test("buildGoogleAdsAuthUrl: never embeds the client secret or developer token in the generated URL", () => {
  withEnv({ GOOGLE_CLIENT_ID: "id", GOOGLE_CLIENT_SECRET: "super-secret-value", GOOGLE_ADS_DEVELOPER_TOKEN: "dev-token-value" }, () => {
    const url = buildGoogleAdsAuthUrl("some-state");
    assert.ok(!url.includes("super-secret-value"));
    assert.ok(!url.includes("dev-token-value"));
  });
});
