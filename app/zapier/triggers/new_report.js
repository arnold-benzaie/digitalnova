"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "listReports" (GET /reports).
//
// Polling trigger: the real /api/v1 list route already returns
// newest-first (orderBy(desc(createdAt)) server-side) — Zapier dedupes
// polled items by "id" automatically, so no manual cursor/date-tracking
// logic is needed here.
const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}/reports`,
    params: { limit: 50 },
  });
  return response.data.data;
};

module.exports = {
  key: "new_report",
  noun: "Report",
  display: {
    label: "New Report",
    description: "Triggers when a new report is found, polling GET /reports (sorted newest-first by the real API).",
  },
  operation: {
    type: "polling",
    perform,
    sample: {
    "id": "00000000-0000-0000-0000-000000000000",
    "score": 82,
    "summary": "Sample report summary.",
    "createdAt": "2026-01-01T00:00:00.000Z",
    "location": null,
    "issueCount": 3,
    "issueCounts": {
      "low": 1,
      "medium": 1,
      "high": 1
    }
  },
    outputFields: [
    {
      "key": "id",
      "label": "Report ID"
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
      "key": "issueCount",
      "label": "Issue Count",
      "type": "integer"
    },
    {
      "key": "createdAt",
      "label": "Created At",
      "type": "datetime"
    }
  ],
  },
};
