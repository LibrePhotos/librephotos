"""The day list of a view: one row per day that holds a photo of it."""

from __future__ import annotations

import datetime
from typing import TypedDict

from django.db.models import Count, F, FloatField, QuerySet, Sum, Value, Window
from django.db.models.functions import Coalesce, RowNumber

from api.models import Photo
from api.timeline.days import OLDEST, day_id, taken_day
from api.timeline.photos import TimelineView


class DayRow(TypedDict):
    id: int
    date: str | None
    location: str
    numberOfItems: int
    aspect_ratio_sum: float


def first_towns(photos: QuerySet[Photo]) -> dict[datetime.date, str]:
    """The place of each day of ``photos``: the town of its first photo that
    has one."""
    first = Window(
        RowNumber(),
        partition_by=[taken_day()],
        order_by=[F("exif_timestamp").asc(), "pk"],
    )
    rows = (
        photos.filter(exif_timestamp__isnull=False)
        .exclude(town="")
        .annotate(day=taken_day(), first=first)
        .filter(first=1)
        .values_list("day", "town")
    )
    return dict(rows)


def _places(view: TimelineView) -> dict[datetime.date, str]:
    """``first_towns`` among the photos of owners who let the requester see
    where they were taken."""
    if not view.place_owners:
        return {}
    located = view.photos.filter(
        owner_id__in=sorted(view.place_owners)  # owner-scope: narrows the view
    )
    return first_towns(located)


# The sum of a day's aspect ratios, a photo without a thumbnail yet counted as a square (the grid
# shows it as one). A client gives a day's placeholders the average, so the day is as wide before
# its photos load as after: short days share a line, and a square guess moved them when they loaded.
_RATIO_SUM = Sum(
    Coalesce("thumbnail__aspect_ratio", Value(1.0), output_field=FloatField()),
    output_field=FloatField(),
)


def day_rows(view: TimelineView) -> list[DayRow]:
    """The days of ``view`` in its order, the undated group last."""
    if view.undated_only:
        totals = view.photos.aggregate(count=Count("pk"), ratios=_RATIO_SUM)
        count = totals["count"]
        return [_row(None, count, totals["ratios"] or 0.0, "")] if count else []
    counts: dict[datetime.date | None, tuple[int, float]] = {
        day: (count, ratios or 0.0)
        for day, count, ratios in view.photos.annotate(day=taken_day())
        .values("day")
        .annotate(count=Count("pk"), ratios=_RATIO_SUM)
        .order_by()
        .values_list("day", "count", "ratios")
    }
    places = _places(view)
    dated = sorted(
        (day for day in counts if day is not None), reverse=view.order != OLDEST
    )
    rows = [_row(day, *counts[day], places.get(day, "")) for day in dated]
    if None in counts:
        rows.append(_row(None, *counts[None], ""))
    return rows


def _row(day: datetime.date | None, count: int, ratios: float, place: str) -> DayRow:
    return {
        "id": day_id(day),
        "date": day.isoformat() if day else None,
        "location": place,
        "numberOfItems": count,
        "aspect_ratio_sum": round(ratios, 3),
    }
