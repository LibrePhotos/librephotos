"""Days, their photos, their order, and the cursor through them.

The order is the one the timeline always had: by date taken (newest or
oldest first), photos taken in the same second by file path (how a camera
numbers a burst, #1937), then by id. Both parts of it are served by an index,
so a page reads its rows instead of sorting the day:

* a dated day is a range of ``api_photo.exif_timestamp`` (its index), the
  same-second ties sorted on the fly;
* the undated group has no timestamp to walk, so it walks the unique index
  on ``api_file.path`` of the photos' main files.

``after`` continues a day after one of its photos (keyset pagination). An
OFFSET would have to count every row before the page, and the planner sorts
the whole day to do that.
"""

from __future__ import annotations

import datetime
import uuid
from enum import Enum
from typing import Final

from django.db.models import Q, QuerySet
from django.db.models.functions import TruncDate

from api.models import Photo, User

NEWEST: Final = User.PhotoOrder.NEWEST.value
OLDEST: Final = User.PhotoOrder.OLDEST.value

#: The id of the undated group: no YYYYMMDD reads as 1.
UNDATED_DAY_ID: Final = 1


def taken_day() -> TruncDate:
    """The day a photo was taken: its wall-clock date (stored as UTC)."""
    return TruncDate("exif_timestamp", tzinfo=datetime.UTC)


def day_id(day: datetime.date | None) -> int:
    """The id of ``day`` in a day list: YYYYMMDD, ``UNDATED_DAY_ID`` for None."""
    if day is None:
        return UNDATED_DAY_ID
    return day.year * 10000 + day.month * 100 + day.day


def taken_day_id(taken: datetime.datetime | None) -> int:
    """The id of the day a photo taken at ``taken`` is listed under."""
    return day_id(taken.astimezone(datetime.UTC).date() if taken else None)


def day_of(day_id: int) -> datetime.date | None:
    """The day an id names; None for the undated group. ``ValueError`` for an
    id that names no day."""
    if day_id == UNDATED_DAY_ID:
        return None
    try:
        return datetime.date(day_id // 10000, day_id // 100 % 100, day_id % 100)
    except (ValueError, OverflowError) as error:
        raise ValueError(f"{day_id} names no day") from error


def _midnight(day: datetime.date) -> datetime.datetime:
    return datetime.datetime.combine(day, datetime.time(), tzinfo=datetime.UTC)


def dates_q(first: datetime.date, last: datetime.date) -> Q:
    """The photos taken from ``first`` to ``last`` (both included), as a range
    the ``exif_timestamp`` index serves: a ``TruncDate`` on the column would
    not."""
    return Q(
        exif_timestamp__gte=_midnight(first),
        exif_timestamp__lt=_midnight(last) + datetime.timedelta(days=1),
    )


def day_q(day: datetime.date | None) -> Q:
    """The photos taken on ``day``; the undated ones for None."""
    if day is None:
        return Q(exif_timestamp__isnull=True)
    return dates_q(day, day)


class Walk(Enum):
    """How a day's photos are ordered, and so which index walks them."""

    #: A dated day: by date taken, then file path, then id.
    TAKEN = "taken"
    #: The undated group: by file path, then id.
    PATH = "path"
    #: An order that says nothing about the photos (the public view of an
    #: owner who keeps dates to themselves): file names tell dates too.
    ID = "id"


def walk_of(undated: bool, opaque: bool) -> Walk:
    if opaque:
        return Walk.ID
    return Walk.PATH if undated else Walk.TAKEN


def ordered(photos: QuerySet[Photo], order: str, walk: Walk) -> QuerySet[Photo]:
    """``photos`` of one day in ``order``.

    ``main_file__path__isnull=False`` (never null: the column defaults to "")
    makes the join to the main file an inner join, so the undated group can be
    read in the order of the path index.
    """
    if walk is Walk.ID:
        return photos.order_by("pk")
    photos = photos.filter(main_file__path__isnull=False)
    if walk is Walk.PATH:
        return photos.order_by("main_file__path", "pk")
    taken = "exif_timestamp" if order == OLDEST else "-exif_timestamp"
    return photos.order_by(taken, "main_file__path", "pk")


class StaleCursorError(Exception):
    """The photo a cursor names is not in the day any more."""


def after(
    photos: QuerySet[Photo], cursor: uuid.UUID | str, order: str, walk: Walk
) -> QuerySet[Photo]:
    """The photos of a day (``photos``, not yet ordered) that come after the
    photo ``cursor`` in ``order``.

    The cursor is looked up among ``photos`` themselves, so it can only name
    a photo the view shows: another user's photo would place its date and
    path among the requester's own. ``StaleCursorError`` when it is not there (it
    was deleted, hidden, or moved to another day).

    Each condition leads with a plain bound (``path >= c``, ``taken <= c``):
    an ``a > c OR (a = c AND ...)`` alone is no index range, and the scan
    started from the first photo of the day.
    """
    row = (
        photos.filter(pk=cursor)
        .values("exif_timestamp", "main_file__path", "pk")
        .first()
    )
    if row is None:
        raise StaleCursorError(cursor)
    taken, path, pk = row["exif_timestamp"], row["main_file__path"], row["pk"]
    if walk is Walk.ID:
        return photos.filter(pk__gt=pk)
    same_second = Q(main_file__path__gt=path) | Q(main_file__path=path, pk__gt=pk)
    if walk is Walk.PATH:
        return photos.filter(Q(main_file__path__gte=path), same_second)
    if order == OLDEST:
        bound, beyond = Q(exif_timestamp__gte=taken), Q(exif_timestamp__gt=taken)
    else:
        bound, beyond = Q(exif_timestamp__lte=taken), Q(exif_timestamp__lt=taken)
    return photos.filter(bound, beyond | (Q(exif_timestamp=taken) & same_second))
