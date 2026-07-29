"use strict";

/**
 * Custom (API key) authentication — matches PUBLIC-MAP's real /api/v1
 * auth model exactly (lib/api-v1/auth.ts: "Authorization: Bearer <key>"),
 * never invented. No OAuth2 flow exists on PUBLIC-MAP's side, so
 * `type: 'custom'` (a single API key field) is the correct scheme, not a
 * simplification — see README.md's "differences from n8n/Make/Airtable"
 * section for why Zapier's own auth model differs from all three again.
 *
 * The key itself is NEVER read, logged, or embedded by this module —
 * Zapier stores it encrypted per end-user connection, and it only ever
 * reaches PUBLIC-MAP via the Authorization header added in
 * `addApiKeyToHeader` below.
 */

const API_BASE_URL = "https://app.public-map.com/api/v1";

/** Reused by every trigger/search/create — see index.js's beforeRequest. */
const addApiKeyToHeader = (request, z, bundle) => {
  if (bundle.authData && bundle.authData.apiKey) {
    request.headers = request.headers || {};
    request.headers.Authorization = `Bearer ${bundle.authData.apiKey}`;
  }
  return request;
};

/**
 * Verifies the key against the real GET /ping route — the same
 * lightweight liveness check documented in the Quick Start guide,
 * reused here rather than inventing a separate verification call.
 * Returns the parsed { pong, organizationId, scopes } object, which
 * becomes `bundle.inputData` for connectionLabel below.
 */
const testAuth = async (z) => {
  const response = await z.request({ url: `${API_BASE_URL}/ping` });
  return response.data.data;
};

module.exports = {
  API_BASE_URL,
  addApiKeyToHeader,
  authentication: {
    type: "custom",
    fields: [
      {
        key: "apiKey",
        label: "API Key",
        type: "password",
        required: true,
        helpText:
          "Create one from the PUBLIC-MAP Developer Console (Settings → API Keys). Only ever sent as an Authorization header to app.public-map.com — never stored or logged by this integration.",
      },
    ],
    test: testAuth,
    connectionLabel: (z, bundle) =>
      `PUBLIC-MAP — organization ${bundle.inputData && bundle.inputData.organizationId}`,
  },
};
