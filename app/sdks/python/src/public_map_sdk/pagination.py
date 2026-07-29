"""Cursor-pagination helper — see lib/api-v1/pagination.ts. The cursor is
always passed back exactly as received (opaque); this module never
inspects or constructs it."""

from __future__ import annotations

from typing import Callable, Generic, Iterator, Optional, TypeVar

from .models import Pagination

T = TypeVar("T")


class Page(Generic[T]):
    """Matches every /api/v1 list response's {data, pagination} shape."""

    def __init__(self, data: list, pagination: Pagination) -> None:
        self.data = data
        self.pagination = pagination


def paginate(fetch_page: Callable[[Optional[str]], "Page[T]"]) -> Iterator[T]:
    """Walks every page of a cursor-paginated list automatically, yielding
    one item at a time.

    >>> for audit in paginate(lambda cursor: client.audits.list(cursor=cursor)):
    ...     print(audit.id)
    """
    cursor: Optional[str] = None
    while True:
        page = fetch_page(cursor)
        for item in page.data:
            yield item
        if not page.pagination.next_cursor:
            return
        cursor = page.pagination.next_cursor
