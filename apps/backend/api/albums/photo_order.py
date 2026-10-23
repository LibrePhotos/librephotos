"""Newest or oldest first: the order of the date-grouped photo lists (#2712).

``/api/albums/date/list/`` and ``/api/albums/date/<id>/`` take ``order``
(``newest``, the default, or ``oldest``). The day list and each day's pages
are sorted on the server, because the client only ever holds the pages it
has scrolled to. The web app sends the order the user saved as
``User.photo_order``; a client that sends none gets newest first, as before.

Either way the days without a date come last: they are not part of the
chronology, and oldest first should open on the first day, not on photos
that have no day. Photos taken in the same second keep the order of their
file paths, which is how a camera numbers a burst.
"""

from __future__ import annotations

from collections.abc import Callable
from typing import TYPE_CHECKING

from django.db.models import F, OrderBy

from api.models import User

if TYPE_CHECKING:
    from api.models import AlbumDate

NEWEST = User.PhotoOrder.NEWEST.value
OLDEST = User.PhotoOrder.OLDEST.value


def day_ordering(order: str) -> OrderBy:
    """Days by date in ``order``, the undated day last."""
    date = F("date")
    return date.asc(nulls_last=True) if order == OLDEST else date.desc(nulls_last=True)


def photo_ordering(order: str) -> tuple[str, str]:
    """A day's photos by date taken in ``order``, then by file path."""
    taken = "exif_timestamp" if order == OLDEST else "-exif_timestamp"
    return taken, "main_file__path"


def day_sort_key(order: str) -> Callable[[AlbumDate], tuple[bool, int]]:
    """``sorted()`` key putting day albums in ``order``, the undated day last."""
    sign = 1 if order == OLDEST else -1

    def key(day: AlbumDate) -> tuple[bool, int]:
        if day.date is None:
            return (True, 0)
        return (False, sign * day.date.toordinal())

    return key
