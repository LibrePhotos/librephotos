"""The days of the public view for owners who keep their dates to themselves.

The public view (``/api/albums/date/list/?public``, a user's public page)
groups public photos by the day they were taken. An owner whose public
sharing switch for dates (``share_timestamps``) is off would still publish
those days through the grouping, so their public photos are one undated
group instead: no day, no place, in an order that says nothing about when
they were taken. The group goes by the id of the owner's first listed day
(``undated_day_id``); their other days are not opened in the public view.
"""

from __future__ import annotations

from collections.abc import Iterable

from django.db.models import QuerySet

from api.models import AlbumDate, User
from api.models.user import public_sharing_settings

# Set on the day standing for an owner's undated group.
UNDATED_ATTR = "public_undated_group"


def owners_sharing_dates(owner_ids: Iterable[int | None]) -> set[int | None]:
    """The owners among ``owner_ids`` whose public pages show dates."""
    ids = {owner_id for owner_id in owner_ids if owner_id is not None}
    owners = User.objects.filter(pk__in=ids).only("public_sharing_defaults")
    return {
        owner.pk
        for owner in owners
        if public_sharing_settings(owner)["share_timestamps"]
    }


def _undated_group(owner_days: list[AlbumDate]) -> AlbumDate:
    """One row for all of an owner's days: the first day, with every photo."""
    group = min(owner_days, key=lambda day: day.pk)
    setattr(
        group, "photo_count", sum(getattr(day, "photo_count") for day in owner_days)
    )
    setattr(group, UNDATED_ATTR, True)
    return group


def public_day_rows(days: Iterable[AlbumDate]) -> list[AlbumDate]:
    """``days`` (annotated with ``photo_count``) as the public view lists them.

    An owner who shares dates keeps their days; one who does not gets one
    undated group, after the dated days.
    """
    days = list(days)
    dated = owners_sharing_dates(day.owner_id for day in days)
    rows = [day for day in days if day.owner_id in dated]
    undated: dict[int | None, list[AlbumDate]] = {}
    for day in days:
        if day.owner_id not in dated:
            undated.setdefault(day.owner_id, []).append(day)
    rows += [_undated_group(owner_days) for owner_days in undated.values()]
    return rows


def undated_day_id(owner_days: QuerySet[AlbumDate]) -> int | None:
    """The id the public view lists an owner's undated group under."""
    first: int | None = owner_days.order_by("pk").values_list("pk", flat=True).first()
    return first
