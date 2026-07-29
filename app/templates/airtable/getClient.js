// PUBLIC-MAP — Get a single client
// Airtable Automation "Run a script" step. This is source code to PASTE
// into that step's code editor — Airtable has no file-import mechanism
// for automations, unlike the n8n/Make templates. See
// templates/airtable/README.md for full setup instructions, including
// which trigger to use (never a webhook trigger — see that file).
//
// Configure these as the script step's input variables in the Airtable automation editor:
//   apiKey  -> a real PUBLIC-MAP API key (Developer Console) — never hardcode one here
//   baseUrl -> optional override, defaults to the real API below
//   id -> the real id to use in this request

const config = input.config();
const baseUrl = config.baseUrl || "https://app.public-map.com/api/v1";
const apiKey = config.apiKey;

if (!apiKey) {
  throw new Error('Set the "apiKey" input variable to a real PUBLIC-MAP API key before running this step.');
}

const url = `${baseUrl}/clients/${config.id}`;

const response = await fetch(url, {
  method: "GET",
  headers: {
    Authorization: `Bearer ${apiKey}`,
  },
});

const responseBody = await response.json();
if (!response.ok) {
  throw new Error(`PUBLIC-MAP API error (${response.status}): ${JSON.stringify(responseBody)}`);
}

output.set("responseStatus", response.status);
output.set("responseBody", responseBody);
