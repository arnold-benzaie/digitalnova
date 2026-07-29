"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "getAudit" (GET /audits/{id}).
const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}/audits/${bundle.inputData.auditId}`,
  });
  return [response.data.data];
};

module.exports = {
  key: "find_audit",
  noun: "Audit",
  display: {
    label: "Find Audit",
    description: "Finds a single audit by ID (GET /audits/{id}).",
  },
  operation: {
    inputFields: [
      { key: "auditId", label: "Audit ID", required: true },
    ],
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
