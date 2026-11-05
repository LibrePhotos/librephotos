"""The day list of a view: one row per day that holds a photo of it."""

from __future__ import annotations

import datetime
from typing import TypedDict

from django.db.models import Count, F, Window
from django.db.models.functions import RowNumber

from api.timeline.days import OLDEST, day_id, taken_day
from api.timeline.photos import TimelineView


class DayRow(TypedDict):
    id: int
    date: str | None
    location: str
    numberOfItems: int


def _places(view: TimelineView) -> dict[datetime.date, str]:
    """The place of each day: the town of its first photo that has one, among
    the photos of owners who let the requester see where they were taken."""
    if not view.place_owners:
        return {}
    first = Window(
        RowNumber(),
        partition_by=[taken_day()],
        order_by=[F("exif_timestamp").asc(), "pk"],
    )
    rows = (
        view.photos.filter(
            owner_id__in=sorted(view.place_owners),  # owner-scope: within the view
            exif_timestamp__isnull=False,
        )
        .exclude(town="")
        .annotate(day=taken_day(), first=first)
        .filter(first=1)
        .values_list("day", "town")
    )
    return dict(rows)


def day_rows(view: TimelineView) -> list[DayRow]:
    """The days of ``view`` in its order, the undated group last."""
    if view.undated_only:
        count = view.photos.count()
        return [_row(None, count, "")] if count else []
    counts = dict(
        view.photos.annotate(day=taken_day())
        .values("day")
        .annotate(count=Count("pk"))
        .order_by()
        .values_list("day", "count")
    )
    places = _places(view)
    dated = sorted(
        (day for day in counts if day is not None), reverse=view.order != OLDEST
    )
    rows = [_row(day, counts[day], places.get(day, "")) for day in dated]
    if None in counts:
        rows.append(_row(None, counts[None], ""))
    return rows


def _row(day: datetime.date | None, count: int, place: str) -> DayRow:
    return {
        "id": day_id(day),
        "date": day.isoformat() if day else None,
        "location": place,
        "numberOfItems": count,
    }
