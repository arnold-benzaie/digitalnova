# public-map-sdk

Official Python SDK for the [PUBLIC-MAP](https://app.public-map.com) public REST API (`/api/v1`). Typed via dataclasses and `Literal` type hints; sync-only in this first release.

> Status: pre-release (`0.1.0`), built alongside the [developer portal](/developers). Not yet published to PyPI.

## Install (once published)

```bash
pip install public-map-sdk
```

## Usage

```python
import os
from public_map_sdk import PublicMapClient

client = PublicMapClient(api_key=os.environ["PUBLIC_MAP_API_KEY"])

page = client.audits.list(limit=20)
for audit in page.data:
    print(audit.id, audit.score)

updated = client.clients.update(client_id, name="New name")

task = client.tasks.create(
    client_id=client_id,
    title="Follow up",
    idempotency_key="task-followup-2026-01",
)

client.close()
```

Or as a context manager:

```python
with PublicMapClient(api_key=api_key) as client:
    client.ping()
```

## Pagination

```python
from public_map_sdk import paginate

for audit in paginate(lambda cursor: client.audits.list(cursor=cursor)):
    print(audit.id)
```

## Error handling

```python
from public_map_sdk import PublicMapApiError

try:
    client.clients.get("unknown-id")
except PublicMapApiError as err:
    print(err.code, err.status, err.request_id)
    if err.code in ("RATE_LIMITED", "QUOTA_EXCEEDED"):
        # err.retry_after_seconds is set
        ...
```

## Development

Unlike the TypeScript SDK, this package's models (`models.py`) are **hand-maintained** against `lib/api-v1/openapi.yaml` (Python codegen from OpenAPI wasn't set up in this stage — see the SDK usage guide's note on this asymmetry). Keep them in sync manually when the spec changes.

```bash
python3 -m venv .venv
source .venv/bin/activate
pip install -e ".[dev]"
pytest    # mocks HTTP via httpx.MockTransport — no live server needed
```

See `/developers/docs/authentication`, `/developers/docs/pagination`, `/developers/docs/rate-limits`, and `/developers/docs/sdk-usage` for the concepts this SDK wraps.
