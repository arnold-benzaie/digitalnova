"use strict";

// GENERATED — do not hand-edit. Regenerate with:
//   npx tsx scripts/generate-zapier-app.mjs
// Source: lib/api-v1/openapi.yaml, operation "createTask" (POST /tasks).
const perform = async (z, bundle) => {
  // Stable per identical input: z.hash() of the input data itself, so a
  // real Zapier-retried perform() (e.g. after a timeout) reuses the same
  // key instead of double-creating — see the Idempotency guide
  // (/developers/docs/idempotency) for what the real API does with a
  // repeated key. Genuinely different input always hashes differently.
  const idempotencyKey = z.hash("sha256", JSON.stringify(bundle.inputData));
  const body = {};
  for (const key of ["clientId","title"]) {
    if (bundle.inputData[key] !== undefined) body[key] = bundle.inputData[key];
  }
  const response = await z.request({
    url: `${bundle.authData.baseUrl || require("../authentication").API_BASE_URL}/tasks`,
    method: "POST",
    body,
    headers: { "Idempotency-Key": idempotencyKey },
  });
  return response.data.data;
};

module.exports = {
  key: "create_task",
  noun: "Task",
  display: {
    label: "Create Task",
    description: "Creates a staff to-do tied to a client (POST /tasks). Supports Idempotency-Key to safely retry.",
  },
  operation: {
    inputFields: [
    {
      "key": "clientId",
      "label": "clientId",
      "required": true
    },
    {
      "key": "title",
      "label": "title",
      "required": true
    }
  ],
    perform,
    sample: {
    "id": "00000000-0000-0000-0000-000000000000",
    "clientId": "00000000-0000-0000-0000-000000000001",
    "title": "Sample task",
    "description": null,
    "dueDate": null,
    "status": "todo",
    "createdAt": "2026-01-01T00:00:00.000Z"
  },
    outputFields: [
    {
      "key": "id",
      "label": "Task ID"
    },
    {
      "key": "clientId",
      "label": "Client ID"
    },
    {
      "key": "title",
      "label": "Title"
    },
    {
      "key": "status",
      "label": "Status"
    },
    {
      "key": "createdAt",
      "label": "Created At",
      "type": "datetime"
    }
  ],
  },
};
