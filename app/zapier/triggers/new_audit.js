"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "listAudits" (GET /audits).
//
// Polling trigger: the real /api/v1 list route already returns
// newest-first (orderBy(desc(createdAt)) server-side) — Zapier dedupes
// polled items by "id" automatically, so no manual cursor/date-tracking
// logic is needed here.
const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}/audits`,
    params: { limit: 50 },
  });
  return response.data.data;
};

module.exports = {
  key: "new_audit",
  noun: "Audit",
  display: {
    label: "New Audit",
    description: "Triggers when a new audit is found, polling GET /audits (sorted newest-first by the real API). No instant/webhook trigger exists yet — see README.md.",
  },
  operation: {
    type: "polling",
    perform,
    sample: {
    "id": "00000000-0000-0000-0000-000000000000",
    "score": 82,
    "summary": "Sample audit summary.",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "location": {
      "id": "00000000-0000-0000-0000-000000000001",
      "name": "Sample Location",
      "address": "1 Sample St"
    }
  },
    outputFields: [
    {
      "key": "id",
      "label": "Audit ID"
    },
    {
      "key": "score",
      "label": "Score",
      "type": "integer"
    },
    {
      "key": "summary",
      "label": "Summary"
    },
    {
      "key": "createdAt",
      "label": "Created At",
      "type": "datetime"
    },
    {
      "key": "location__id",
      "label": "Location ID"
    },
    {
      "key": "location__name",
      "label": "Location Name"
    }
  ],
  },
};
