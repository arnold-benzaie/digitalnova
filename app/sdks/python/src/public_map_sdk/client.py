"""Official Python client for the PUBLIC-MAP public REST API. Every method
corresponds 1:1 to an operation in lib/api-v1/openapi.yaml. Sync only in
this stage (0.1.0) — an async client is a natural, separately-scoped
future addition (see the SDK usage guide), not built here to keep this
stage's surface area reviewable."""

from __future__ import annotations

from typing import Any, Dict, Optional

import httpx

from .errors import PublicMapApiError, PublicMapUnexpectedResponseError
from .models import Audit, Client as ClientModel, Interaction, Pagination, Report, ReportListItem, Task
from .pagination import Page

DEFAULT_BASE_URL = "https://app.public-map.com/api/v1"


class PublicMapClient:
    """
    Example:
        >>> client = PublicMapClient(api_key=os.environ["PUBLIC_MAP_API_KEY"])
        >>> page = client.audits.list(limit=20)
        >>> client.close()
    """

    def __init__(self, *, api_key: str, base_url: str = DEFAULT_BASE_URL, http_client: Optional[httpx.Client] = None) -> None:
        if not api_key:
            raise ValueError("PublicMapClient requires an api_key.")
        self._api_key = api_key
        self._base_url = base_url.rstrip("/")
        self._http = http_client or httpx.Client()
        self._owns_http_client = http_client is None

        self.audits = _Audits(self)
        self.reports = _Reports(self)
        self.clients = _Clients(self)
        self.tasks = _Tasks(self)
        self.interactions = _Interactions(self)

    def close(self) -> None:
        """Closes the underlying HTTP connection pool — only actually
        closes it if this client created it itself (not a caller-supplied
        httpx.Client, which the caller owns)."""
        if self._owns_http_client:
            self._http.close()

    def __enter__(self) -> "PublicMapClient":
        return self

    def __exit__(self, *_exc: object) -> None:
        self.close()

    def ping(self) -> Dict[str, Any]:
        """Confirms the key is valid and lists the scopes it carries — see the Quick Start guide."""
        return self._request("GET", "/ping")

    def _request(
        self,
        method: str,
        path: str,
        *,
        params: Optional[Dict[str, Any]] = None,
        json_body: Optional[Dict[str, Any]] = None,
        idempotency_key: Optional[str] = None,
    ) -> Any:
        headers = {"Authorization": f"Bearer {self._api_key}"}
        if idempotency_key:
            headers["Idempotency-Key"] = idempotency_key

        clean_params = {k: v for k, v in (params or {}).items() if v is not None}

        response = self._http.request(method, f"{self._base_url}{path}", params=clean_params or None, json=json_body, headers=headers)

        try:
            payload = response.json() if response.content else None
        except ValueError as exc:
            raise PublicMapUnexpectedResponseError(response.status_code, response.text) from exc

        if response.is_error:
            error = (payload or {}).get("error")
            if not error:
                raise PublicMapUnexpectedResponseError(response.status_code, response.text)
            retry_after = response.headers.get("Retry-After")
            raise PublicMapApiError(
                code=error.get("code", "INTERNAL_ERROR"),
                message=error.get("message", "Unknown error."),
                status=response.status_code,
                request_id=error.get("requestId", ""),
                retry_after_seconds=int(retry_after) if retry_after else None,
            )

        if isinstance(payload, dict) and "pagination" in payload:
            return payload
        return (payload or {}).get("data")


class _Audits:
    def __init__(self, client: PublicMapClient) -> None:
        self._client = client

    def list(
        self, *, limit: Optional[int] = None, cursor: Optional[str] = None, from_: Optional[str] = None, to: Optional[str] = None, q: Optional[str] = None
    ) -> Page[Audit]:
        body = self._client._request("GET", "/audits", params={"limit": limit, "cursor": cursor, "from": from_, "to": to, "q": q})
        return Page(data=[Audit.from_dict(row) for row in body["data"]], pagination=Pagination.from_dict(body["pagination"]))

    def get(self, audit_id: str) -> Audit:
        return Audit.from_dict(self._client._request("GET", f"/audits/{audit_id}"))


class _Reports:
    def __init__(self, client: PublicMapClient) -> None:
        self._client = client

    def list(
        self, *, limit: Optional[int] = None, cursor: Optional[str] = None, from_: Optional[str] = None, to: Optional[str] = None, q: Optional[str] = None
    ) -> Page[ReportListItem]:
        body = self._client._request("GET", "/reports", params={"limit": limit, "cursor": cursor, "from": from_, "to": to, "q": q})
        return Page(data=[ReportListItem.from_dict(row) for row in body["data"]], pagination=Pagination.from_dict(body["pagination"]))

    def get(self, audit_id: str) -> Report:
        return Report.from_dict(self._client._request("GET", f"/reports/{audit_id}"))


class _Clients:
    def __init__(self, client: PublicMapClient) -> None:
        self._client = client

    def list(
        self,
        *,
        limit: Optional[int] = None,
        cursor: Optional[str] = None,
        from_: Optional[str] = None,
        to: Optional[str] = None,
        q: Optional[str] = None,
        stage: Optional[str] = None,
    ) -> Page[ClientModel]:
        body = self._client._request("GET", "/clients", params={"limit": limit, "cursor": cursor, "from": from_, "to": to, "q": q, "stage": stage})
        return Page(data=[ClientModel.from_dict(row) for row in body["data"]], pagination=Pagination.from_dict(body["pagination"]))

    def get(self, client_id: str) -> ClientModel:
        return ClientModel.from_dict(self._client._request("GET", f"/clients/{client_id}"))

    def update(
        self,
        client_id: str,
        *,
        name: Optional[str] = None,
        contact_name: Optional[str] = None,
        email: Optional[str] = None,
        phone: Optional[str] = None,
        address: Optional[str] = None,
    ) -> ClientModel:
        """Only the fields you pass (non-None) are sent to the API — see
        lib/api-v1/clients.ts's CLIENT_PATCHABLE_FIELDS whitelist. Passing
        `None` for contact_name/email/phone/address here simply omits that
        field from the request (leaves it untouched server-side); the API
        itself is what enforces the whitelist and rejects unknown fields."""
        patch: Dict[str, Any] = {}
        if name is not None:
            patch["name"] = name
        if contact_name is not None:
            patch["contactName"] = contact_name
        if email is not None:
            patch["email"] = email
        if phone is not None:
            patch["phone"] = phone
        if address is not None:
            patch["address"] = address
        return ClientModel.from_dict(self._client._request("PATCH", f"/clients/{client_id}", json_body=patch))


class _Tasks:
    def __init__(self, client: PublicMapClient) -> None:
        self._client = client

    def create(
        self,
        *,
        client_id: str,
        title: str,
        description: Optional[str] = None,
        due_date: Optional[str] = None,
        status: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Task:
        body: Dict[str, Any] = {"clientId": client_id, "title": title}
        if description is not None:
            body["description"] = description
        if due_date is not None:
            body["dueDate"] = due_date
        if status is not None:
            body["status"] = status
        return Task.from_dict(self._client._request("POST", "/tasks", json_body=body, idempotency_key=idempotency_key))


class _Interactions:
    def __init__(self, client: PublicMapClient) -> None:
        self._client = client

    def create(
        self,
        *,
        client_id: str,
        type: str,
        summary: str,
        occurred_at: Optional[str] = None,
        idempotency_key: Optional[str] = None,
    ) -> Interaction:
        body: Dict[str, Any] = {"clientId": client_id, "type": type, "summary": summary}
        if occurred_at is not None:
            body["occurredAt"] = occurred_at
        return Interaction.from_dict(self._client._request("POST", "/interactions", json_body=body, idempotency_key=idempotency_key))
