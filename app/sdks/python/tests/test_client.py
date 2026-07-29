import json

import httpx
import pytest

from public_map_sdk import PublicMapApiError, PublicMapClient


def make_client(handler) -> PublicMapClient:
    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    return PublicMapClient(api_key="pm_live_test", http_client=http_client)


def test_constructor_requires_api_key():
    with pytest.raises(ValueError):
        PublicMapClient(api_key="")


def test_ping_sends_bearer_and_returns_parsed_data():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        captured["auth"] = request.headers.get("authorization")
        return httpx.Response(200, json={"data": {"pong": True, "organizationId": "org-1", "scopes": ["audits:read"]}})

    client = make_client(handler)
    result = client.ping()

    assert captured["url"] == "https://app.public-map.com/api/v1/ping"
    assert captured["auth"] == "Bearer pm_live_test"
    assert result == {"pong": True, "organizationId": "org-1", "scopes": ["audits:read"]}


def test_audits_list_serializes_query_params_and_returns_page():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(
            200,
            json={
                "data": [{"id": "a1", "score": 90, "summary": None, "createdAt": "2026-01-01T00:00:00Z", "location": None}],
                "pagination": {"limit": 5, "nextCursor": None},
            },
        )

    client = make_client(handler)
    page = client.audits.list(limit=5, q="café")

    assert "limit=5" in captured["url"]
    assert "caf" in captured["url"]  # URL-encoded, just check the ASCII prefix survives
    assert len(page.data) == 1
    assert page.data[0].id == "a1"
    assert page.pagination.limit == 5
    assert page.pagination.next_cursor is None


def test_tasks_create_sends_idempotency_key_header():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["headers"] = request.headers
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            201,
            json={"data": {"id": "t1", "clientId": "c1", "title": "x", "description": None, "dueDate": None, "status": "todo", "createdAt": "2026-01-01T00:00:00Z"}},
        )

    client = make_client(handler)
    task = client.tasks.create(client_id="c1", title="Call back", idempotency_key="retry-key-1")

    assert captured["headers"]["idempotency-key"] == "retry-key-1"
    assert captured["body"] == {"clientId": "c1", "title": "Call back"}
    assert task.id == "t1"


def test_clients_update_patches_only_provided_fields():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["method"] = request.method
        captured["body"] = json.loads(request.content)
        return httpx.Response(
            200,
            json={"data": {"id": "c1", "name": "New Name", "contactName": None, "email": None, "phone": None, "address": None, "stage": "client", "createdAt": "2026-01-01T00:00:00Z"}},
        )

    client = make_client(handler)
    updated = client.clients.update("c1", name="New Name")

    assert captured["method"] == "PATCH"
    assert captured["body"] == {"name": "New Name"}
    assert updated.name == "New Name"


def test_non_2xx_response_raises_public_map_api_error_with_details():
    def handler(request: httpx.Request) -> httpx.Response:
        return httpx.Response(
            429,
            json={"error": {"code": "RATE_LIMITED", "message": "Too many requests.", "requestId": "req-123"}},
            headers={"Retry-After": "42"},
        )

    client = make_client(handler)

    with pytest.raises(PublicMapApiError) as exc_info:
        client.ping()

    err = exc_info.value
    assert err.code == "RATE_LIMITED"
    assert err.status == 429
    assert err.request_id == "req-123"
    assert err.retry_after_seconds == 42


def test_base_url_override_and_trailing_slash_normalization():
    captured = {}

    def handler(request: httpx.Request) -> httpx.Response:
        captured["url"] = str(request.url)
        return httpx.Response(200, json={"data": {"pong": True, "organizationId": "o", "scopes": []}})

    transport = httpx.MockTransport(handler)
    http_client = httpx.Client(transport=transport)
    client = PublicMapClient(api_key="k", base_url="http://localhost:3000/api/v1/", http_client=http_client)
    client.ping()

    assert captured["url"] == "http://localhost:3000/api/v1/ping"
