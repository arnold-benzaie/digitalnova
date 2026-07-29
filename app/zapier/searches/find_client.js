"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "getClient" (GET /clients/{id}).
const perform = async (z, bundle) => {
  const response = await z.request({
    url: `${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}/clients/${bundle.inputData.clientId}`,
  });
  return [response.data.data];
};

module.exports = {
  key: "find_client",
  noun: "Client",
  display: {
    label: "Find Client",
    description: "Finds a single client by ID (GET /clients/{id}).",
  },
  operation: {
    inputFields: [
      { key: "clientId", label: "Client ID", required: true },
    ],
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
