"""A photo's capture time, read from its file by the owner's datetime rules,
and the day album that follows from it.

Moved out of ``Photo``; every function takes the photo as its first argument.
"""

from __future__ import annotations

import json
from typing import TYPE_CHECKING, Any

import api.models
from api import date_time_extractor
from api.metadata.reader import get_metadata

if TYPE_CHECKING:
    from api.models.album_date import AlbumDate
    from api.models.photo import Photo


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
    """Set ``exif_timestamp`` from the file and move the photo to its day album."""
    assert photo.main_file is not None
    main_file_path = photo.main_file.path

    def exif_getter(tags: list[str]) -> list[Any]:
        return get_metadata(main_file_path, tags=tags, try_sidecar=True)

    # Stored as the JSON string the settings page sends (and the default is),
    # but PATCH /api/user/ also accepts the list itself.
    datetime_config = photo.owner.datetime_rules
    if isinstance(datetime_config, str):
        datetime_config = json.loads(datetime_config)
    extracted_local_time = date_time_extractor.extract_local_date_time(
        main_file_path,
        date_time_extractor.as_rules(datetime_config),
        exif_getter,
        photo.exif_gps_lat,
        photo.exif_gps_lon,
        photo.owner.default_timezone,
        photo.timestamp,
    )

    old_album_date = find_album_date(photo)
    if photo.exif_timestamp != extracted_local_time:
        photo.exif_timestamp = extracted_local_time

    if old_album_date is not None:
        old_album_date.photos.remove(photo)
        old_album_date.save()

    album_date = None

    if photo.exif_timestamp:
        album_date = api.models.album_date.get_or_create_album_date(
            date=photo.exif_timestamp.date(), owner=photo.owner
        )
        album_date.photos.add(photo)
    else:
        album_date = api.models.album_date.get_or_create_album_date(
            date=None, owner=photo.owner
        )
        album_date.photos.add(photo)

    if commit:
        photo.save()
    album_date.save()
