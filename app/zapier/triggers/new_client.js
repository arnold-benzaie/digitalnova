"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "listClients" (GET /clients).
//
// Polling trigger: the real /api/v1 list route already returns
// newest-first (orderBy(desc(createdAt)) server-side) — Zapier dedupes
// polled items by "id" automatically, so no manual cursor/date-tracking
// logic is needed here.
const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}/clients`,
    params: { limit: 50 },
  });
  return response.data.data;
};

module.exports = {
  key: "new_client",
  noun: "Client",
  display: {
    label: "New Client",
    description: "Triggers when a new client is found, polling GET /clients (sorted newest-first by the real API).",
  },
  operation: {
    type: "polling",
    perform,
    sample: {
    "id": "00000000-0000-0000-0000-000000000000",
    "name": "Sample Client",
    "contactName": "Jane Doe",
    "email": "jane@example.com",
    "phone": null,
    "address": null,
    "stage": "lead",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
    outputFields: [
    {
      "key": "id",
      "label": "Client ID"
    },
    {
      "key": "name",
      "label": "Name"
    },
    {
      "key": "contactName",
      "label": "Contact Name"
    },
    {
      "key": "email",
      "label": "Email"
    },
    {
      "key": "stage",
      "label": "Stage"
    },
    {
      "key": "createdAt",
      "label": "Created At",
      "type": "datetime"
    }
  ],
  },
};
