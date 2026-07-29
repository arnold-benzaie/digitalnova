"""Mirrors lib/api-v1/errors.ts's ApiErrorCode — see the Error.properties.code
enum in lib/api-v1/openapi.yaml (the single source of truth every SDK,
including this one, is kept in sync with)."""

from __future__ import annotations

from typing import Literal, Optional

PublicMapErrorCode = Literal[
    "MISSING_API_KEY",
    "MALFORMED_API_KEY",
    "INVALID_API_KEY",
    "API_KEY_REVOKED",
    "API_KEY_EXPIRED",
    "INTEGRATION_INACTIVE",
    "INTEGRATION_EXPIRED",
    "FORBIDDEN_SCOPE",
    "SERVICE_NOT_CONFIGURED",
    "VALIDATION_ERROR",
    "NOT_FOUND",
    "IDEMPOTENCY_KEY_CONFLICT",
    "RATE_LIMITED",
    "QUOTA_EXCEEDED",
    "INTERNAL_ERROR",
]
"""Documents the known codes for autocomplete; `PublicMapApiError.code` itself
is typed as plain `str` (see below) so a future API version's new code is
never a type error to handle — mirrors the TypeScript SDK's `string & {}`
widening trick, adapted to Python's type system."""


class PublicMapApiError(Exception):
    """Raised for every non-2xx /api/v1 response. `code` is the stable,
    switchable value (`if err.code == "RATE_LIMITED"`); `message` is for
    humans and may change between API versions; `request_id` is what to
    quote back to PUBLIC-MAP if you need help with a specific request."""

    def __init__(self, *, code: str, message: str, status: int, request_id: str, retry_after_seconds: Optional[int] = None) -> None:
        super().__init__(f"[{code}] {message} (status={status}, requestId={request_id})")
        self.code = code
        self.message = message
        self.status = status
        self.request_id = request_id
        self.retry_after_seconds = retry_after_seconds


class PublicMapUnexpectedResponseError(Exception):
    """Raised when the client can't even parse a response as the expected
    {"error": {...}} envelope — a genuinely unexpected condition, never a
    normal API error path."""

    def __init__(self, status: int, body: str) -> None:
        super().__init__(f"Unexpected response (status {status}) — could not parse an error envelope.")
        self.status = status
        self.body = body
