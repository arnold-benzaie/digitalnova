from public_map_sdk import Page, Pagination, paginate


def test_paginate_walks_every_page_in_order():
    pages = [
        Page(data=[1, 2], pagination=Pagination(limit=2, next_cursor="cursor-a")),
        Page(data=[3, 4], pagination=Pagination(limit=2, next_cursor="cursor-b")),
        Page(data=[5], pagination=Pagination(limit=2, next_cursor=None)),
    ]
    seen_cursors = []
    call_index = 0

    def fetch_page(cursor):
        nonlocal call_index
        seen_cursors.append(cursor)
        page = pages[call_index]
        call_index += 1
        return page

    items = list(paginate(fetch_page))

    assert items == [1, 2, 3, 4, 5]
    assert seen_cursors == [None, "cursor-a", "cursor-b"]


def test_paginate_stops_on_single_empty_page():
    items = list(paginate(lambda cursor: Page(data=[], pagination=Pagination(limit=20, next_cursor=None))))
    assert items == []
