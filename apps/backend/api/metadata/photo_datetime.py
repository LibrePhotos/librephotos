"""A photo's capture time, set by hand or read from its file by the owner's
datetime rules. The day a photo is listed under follows from it
(``api.timeline``): nothing else moves.

Moved out of ``Photo``; every function takes the photo as its first argument.
"""

from __future__ import annotations

import json
import os
from datetime import datetime
from typing import TYPE_CHECKING, Any, TypedDict

from django.db.models import QuerySet
from django.utils import timezone

import api.models
from api.metadata import datetime_rules
from api.metadata.datetime_rules import CaptureTime, RuleOutcome
from api.metadata.reader import (
    MetadataFileMissingError,
    get_metadata,
    sidecar_files_for_photo,
)
from api.metadata.takeout import takeout_metadata_for

if TYPE_CHECKING:
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


def extract_date_time(photo: Photo, commit: bool = True) -> None:
    """Set ``exif_timestamp``, its UTC offset and source.

    A date the user set by hand (``Photo.timestamp``) is the photo's date,
    whatever the owner's rule list says (#2254): no rule is its source, and
    its offset is the one set with it (an upload's device time) or none
    (``api.metadata.edits.set_capture_time`` clears it). Without one the
    owner's datetime rules read the date from the file.
    """
    found: CaptureTime | None
    if photo.timestamp is not None:
        found = CaptureTime(photo.timestamp, photo.exif_timestamp_offset)
    else:
        found = _capture_time_from_file(photo)
    _set_offset_and_source(photo, found)

    photo.exif_timestamp = found.local_time if found else None
    if commit:
        photo.save()


def reapply_date_rules(photo: Photo) -> bool:
    """Read the photo's date again with its owner's current datetime rules.

    For photos already in the library (#437): only ``exif_timestamp``, its
    UTC offset and source (#2768), and ``last_modified`` (mobile sync, when the
    date moved) change, and nothing is written to the
    file. A date set by hand wins over the rules (#2254), also one set while
    this ran: the row is only written while it has none.
    Returns whether the photo got another date or UTC offset.
    """
    if photo.timestamp is not None:
        return False
    found = _capture_time_from_file(photo)
    new_time = found.local_time if found else None
    old_offset = photo.exif_timestamp_offset
    old_source = photo.exif_timestamp_source
    _set_offset_and_source(photo, found)
    moved = new_time != photo.exif_timestamp
    offset_changed = photo.exif_timestamp_offset != old_offset
    if not (moved or offset_changed or photo.exif_timestamp_source != old_source):
        return False
    fields: dict[str, object] = {
        "exif_timestamp": new_time,
        "exif_timestamp_offset": photo.exif_timestamp_offset,
        "exif_timestamp_source": photo.exif_timestamp_source,
    }
    if moved:
        fields["last_modified"] = timezone.now()
    written = api.models.Photo.objects.filter(
        pk=photo.pk, timestamp__isnull=True
    ).update(**fields)
    if not written:
        return False
    photo.exif_timestamp = new_time
    return moved or offset_changed


def _set_offset_and_source(photo: Photo, found: CaptureTime | None) -> None:
    """Give the photo the UTC offset and the rule id of ``found``, unsaved."""
    photo.exif_timestamp_offset = found.utc_offset if found else None
    photo.exif_timestamp_source = found.rule_id if found else None


def _capture_time_from_file(photo: Photo) -> CaptureTime | None:
    """The capture time the owner's datetime rules read from the photo's files."""
    return datetime_rules.extract_local_date_time(*_rule_inputs(photo))


def date_rule_outcomes(photo: Photo) -> list[RuleOutcome]:
    """What each of the owner's saved date rules reads from the photo's files,
    in rule order, without changing anything: "Why this date?" (#2272). A
    scan takes the first one that found a date, unless the date was set by
    hand (``extract_date_time``).

    Raises ``MetadataFileMissingError`` when the file is not on disk and
    ``MetadataReadError`` when the exif service cannot read it."""
    if photo.main_file is None or not os.path.isfile(photo.main_file.path):
        raise MetadataFileMissingError("the file is not on disk")
    return datetime_rules.evaluate_rules(*_rule_inputs(photo))


RuleInputs = tuple[
    str,
    list[datetime_rules.TimeExtractionRule],
    datetime_rules.ExifGetter,
    datetime_rules.RuleContext,
]


def _rule_inputs(photo: Photo) -> RuleInputs:
    """The photo's main file, the owner's datetime rules, a reader of the
    file's tags and what else the rules may use."""
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
    return (
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
