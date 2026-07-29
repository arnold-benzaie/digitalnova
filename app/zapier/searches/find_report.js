"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "getReport" (GET /reports/{id}).
const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}/reports/${bundle.inputData.reportId}`,
  });
  return [response.data.data];
};

module.exports = {
  key: "find_report",
  noun: "Report",
  display: {
    label: "Find Report",
    description: "Finds a single report by ID (GET /reports/{id}).",
  },
  operation: {
    inputFields: [
      { key: "reportId", label: "Report ID", required: true },
    ],
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
