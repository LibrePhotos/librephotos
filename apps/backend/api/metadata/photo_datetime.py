"""A photo's capture time, set by hand or read from its file by the owner's
datetime rules, and the day album that follows from it.

Moved out of ``Photo``; every function takes the photo as its first argument.
"""

from __future__ import annotations

import json
from datetime import datetime
from typing import TYPE_CHECKING, Any, TypedDict

from django.db.models import QuerySet
from django.utils import timezone

import api.models
from api.metadata import datetime_rules
from api.metadata.reader import get_metadata, sidecar_files_for_photo
from api.metadata.takeout import takeout_metadata_for

if TYPE_CHECKING:
    from api.models.album_date import AlbumDate
    from api.models.photo import Photo


class DatedPhoto(TypedDict):
    image_hash: str
    exif_timestamp: datetime


class DateSummary(TypedDict):
    """Where a selection's dates stand (``date_summary``)."""

    count: int
    without_date: int
    oldest: DatedPhoto | None
    newest: DatedPhoto | None


def date_summary(photos: QuerySet[Photo]) -> DateSummary:
    """How many of ``photos`` there are, how many have no date, and the
    oldest and newest dated one: what the bulk date dialog previews (#2278)."""
    dated = photos.filter(exif_timestamp__isnull=False)
    return {
        "count": photos.count(),
        "without_date": photos.filter(exif_timestamp__isnull=True).count(),
        "oldest": _first_dated(dated.order_by("exif_timestamp", "image_hash")),
        "newest": _first_dated(dated.order_by("-exif_timestamp", "-image_hash")),
    }


def _first_dated(photos: QuerySet[Photo]) -> DatedPhoto | None:
    row = photos.values_list("image_hash", "exif_timestamp").first()
    if row is None:
        return None
    image_hash, timestamp = row
    assert timestamp is not None
    return {"image_hash": image_hash, "exif_timestamp": timestamp}


def find_album_date(photo: Photo) -> AlbumDate | None:
    """The day album the photo currently sits in, or None."""
    old_album_date = None
    if photo.exif_timestamp:
        possible_old_album_date = api.models.album_date.get_album_date(
            date=photo.exif_timestamp.date(), owner=photo.owner
        )
        if (
            possible_old_album_date is not None
            and possible_old_album_date.photos.filter(
                image_hash=photo.image_hash
            ).exists()
        ):
            old_album_date = possible_old_album_date
    else:
        possible_old_album_date = api.models.album_date.get_album_date(
            date=None, owner=photo.owner
        )
        if (
            possible_old_album_date is not None
            and possible_old_album_date.photos.filter(
                image_hash=photo.image_hash
            ).exists()
        ):
            old_album_date = possible_old_album_date
    return old_album_date


def extract_date_time(photo: Photo, commit: bool = True) -> None:
    """Set ``exif_timestamp`` and move the photo to its day album.

    A date the user set by hand (``Photo.timestamp``) is the photo's date,
    whatever the owner's rule list says (#2254); without one the owner's
    datetime rules read it from the file.
    """
    extracted_local_time: datetime | None
    if photo.timestamp is not None:
        extracted_local_time = photo.timestamp
    else:
        extracted_local_time = _date_time_from_file(photo)

    album_date = _move_to_day_album(photo, extracted_local_time)
    if commit:
        photo.save()
    album_date.save()


def reapply_date_rules(photo: Photo) -> bool:
    """Read the photo's date again with its owner's current datetime rules.

    For photos already in the library (#437): only ``exif_timestamp``,
    ``last_modified`` (mobile sync) and the day album change, and nothing is
    written to the file. A date set by hand wins over the rules (#2254), also
    one set while this ran: the row is only written while it has none.
    Returns whether the photo moved to another date.
    """
    if photo.timestamp is not None:
        return False
    new_time = _date_time_from_file(photo)
    if new_time == photo.exif_timestamp:
        return False
    written = api.models.Photo.objects.filter(
        pk=photo.pk, timestamp__isnull=True
    ).update(exif_timestamp=new_time, last_modified=timezone.now())
    if not written:
        return False
    _move_to_day_album(photo, new_time).save()
    return True


def _move_to_day_album(photo: Photo, local_time: datetime | None) -> AlbumDate:
    """Give the photo ``local_time`` and move it from its old day album to the
    one of that day (the undated album for None). Returns the new album,
    unsaved; the photo is not saved either."""
    old_album_date = find_album_date(photo)
    photo.exif_timestamp = local_time

    if old_album_date is not None:
        old_album_date.photos.remove(photo)
        old_album_date.save()

    album_date = api.models.album_date.get_or_create_album_date(
        date=local_time.date() if local_time else None, owner=photo.owner
    )
    album_date.photos.add(photo)
    return album_date


def _date_time_from_file(photo: Photo) -> datetime | None:
    """The capture time the owner's datetime rules read from the photo's files."""
    assert photo.main_file is not None
    main_file_path = photo.main_file.path
    sidecar_files = sidecar_files_for_photo(photo)

    def exif_getter(tags: list[str]) -> list[Any]:
        return get_metadata(main_file_path, tags=tags, sidecar_files=sidecar_files)

    def takeout_taken_at() -> datetime | None:
        takeout = takeout_metadata_for(main_file_path)
        return takeout.taken_at if takeout else None

    # Stored as the JSON string the settings page sends (and the default is),
    # but PATCH /api/user/ also accepts the list itself.
    datetime_config = photo.owner.datetime_rules
    if isinstance(datetime_config, str):
        datetime_config = json.loads(datetime_config)
    return datetime_rules.extract_local_date_time(
        main_file_path,
        datetime_rules.as_rules(datetime_config),
        exif_getter,
        datetime_rules.RuleContext(
            gps_lat=photo.exif_gps_lat,
            gps_lon=photo.exif_gps_lon,
            user_default_tz=photo.owner.default_timezone,
            takeout_taken_at=takeout_taken_at,
        ),
    )
