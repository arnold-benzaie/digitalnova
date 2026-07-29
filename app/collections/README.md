# API client collections

Postman, Bruno, and Insomnia collections for the PUBLIC-MAP public REST API (`/api/v1`), covering all 9 real routes (10 operations including `/ping`).

**Generated, not hand-maintained** — the single source of truth is [`lib/api-v1/openapi.yaml`](../lib/api-v1/openapi.yaml). Regenerate after any spec change:

```bash
npx tsx scripts/generate-client-collections.mjs
```

Never hand-edit anything under `postman/`, `bruno/`, or `insomnia/` — those edits are lost on the next regeneration.

## Import

| Tool | File | How |
|---|---|---|
| **Postman** | `postman/public-map-api.postman_collection.json` | File → Import → select the file. Set the `bearerToken` collection variable to your API key. |
| **Bruno** | `bruno/` (whole folder) | Open Bruno → Import Collection → select the `bruno/` folder. Select the "production" environment and set `bearerToken`. |
| **Insomnia** | `insomnia/public-map-api.insomnia.json` | Application menu → Preferences → Data → Import Data → From File. Set `bearerToken` in the imported "Base Environment". |

Every request uses a `baseUrl` variable (defaults to `https://app.public-map.com/api/v1`) and a `bearerToken` variable you fill in yourself — no real key is ever baked into these files.

## Why these three formats, generated this way

- **Postman**: generated via [`openapi-to-postmanv2`](https://www.npmjs.com/package/openapi-to-postmanv2), the official Postman-maintained converter — full fidelity (folders by resource, auth, example responses, declared variables).
- **Bruno** and **Insomnia**: hand-written directly from the parsed spec in `scripts/generate-client-collections.mjs`. Both tools' own official OpenAPI-import packages were evaluated first and rejected — see that script's header comment for exactly why (an undocumented internal transform for Bruno's converter output; a critical transitive vulnerability pulled in by Insomnia's importer package, from a WSDL/XML importer this project never uses). Both target formats (Bruno's `.bru` text DSL, Insomnia's v4 export JSON) are simple and well-documented enough to generate directly and safely.

All three tools also support importing an OpenAPI spec **directly** (File → Import → OpenAPI) — you can always point any of them at [`/developers/openapi.yaml`](../lib/api-v1/openapi.yaml) instead of these pre-built collections if you prefer.
