// PUBLIC-MAP — Create a staff to-do tied to a client
// Airtable Automation "Run a script" step. This is source code to PASTE
// into that step's code editor — Airtable has no file-import mechanism
// for automations, unlike the n8n/Make templates. See
// templates/airtable/README.md for full setup instructions, including
// which trigger to use (never a webhook trigger — see that file).
//
// Configure these as the script step's input variables in the Airtable automation editor:
//   apiKey  -> a real PUBLIC-MAP API key (Developer Console) — never hardcode one here
//   baseUrl -> optional override, defaults to the real API below

const config = input.config();
const baseUrl = config.baseUrl || "https://app.public-map.com/api/v1";
const apiKey = config.apiKey;

if (!apiKey) {
  throw new Error('Set the "apiKey" input variable to a real PUBLIC-MAP API key before running this step.');
}

const url = `${baseUrl}/tasks`;

const response = await fetch(url, {
  method: "POST",
  headers: {
    Authorization: `Bearer ${apiKey}`,
    "Content-Type": "application/json",
    "Idempotency-Key": `${Date.now()}-${Math.random().toString(36).slice(2)}`,
  },
  body: JSON.stringify({
    "clientId": "00000000-0000-0000-0000-000000000000",
    "title": ""
  }),
});

const responseBody = await response.json();
if (!response.ok) {
  throw new Error(`PUBLIC-MAP API error (${response.status}): ${JSON.stringify(responseBody)}`);
}

output.set("responseStatus", response.status);
output.set("responseBody", responseBody);
