"""The one write path for a user's edits of a photo's descriptive metadata (#2252).

Each user-editable field has exactly one store, and every endpoint that edits
it (the lightbox, ``/photosedit/*``, ``PATCH /photos/edit/``, the metadata API
and its bulk variant, revert and revert-all) goes through the setter here:

=========================  ===================================================
Field                      Canonical store
=========================  ===================================================
capture date               ``Photo.timestamp``, which overrides the owner's
                           datetime rules in ``exif_timestamp``
location                   ``Photo.exif_gps_lat`` / ``exif_gps_lon``, with
                           ``geolocation_json``, ``PhotoSearch.search_location``
                           and the Places albums derived from it
rating / favorite          ``Photo.rating``
caption                    ``PhotoCaption.captions_json["user_caption"]``
keywords                   the photo's ``Tag`` rows, the list in
                           ``PhotoMetadata.edited_keywords``;
                           ``PhotoMetadata.keywords`` stays the file's
                           keywords at the last read (#2783)
title, copyright, creator, ``PhotoMetadata``
license
=========================  ===================================================

A setter writes the store, records a ``MetadataEdit`` per changed photo (the
edit history that revert works from), bumps ``Photo.last_modified`` so the
mobile delta feed and the clients' caches see the change, refreshes
``PhotoSearch`` where the field is indexed, and writes the value back to the
file or sidecar when the owner syncs metadata to disk. Write-back covers the
rating, the capture date, the caption, the keywords (#2289) and the location
(#2290), and the rights: copyright, creator and license (#425); the title is
not written to files yet. Tags are the keywords
the user edits (#2230): ``tags_changed`` writes the tags an edit of the tag
endpoints touched, which have no edit history.

``PhotoMetadata`` otherwise holds what the file says (camera, lens, exposure,
size) and is filled by the scan, not by these setters.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Callable, Collection, Iterable, Mapping
from dataclasses import dataclass
from datetime import datetime, timedelta
from typing import NamedTuple

from django.db import transaction
from django.db.models import F, QuerySet
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.geocode import GEOCODE_VERSION
from api.geocode.geocode import reverse_geocode
from api.geocode.photo_location import clear_location, usable_coordinates
from api.metadata.jobs import (
    queue_field_write,
    queue_keyword_write,
    queue_rating_write,
)
from api.metadata.photo_datetime import extract_date_time
from api.metadata.photo_reader import read_file_values
from api.metadata.photo_writer import write_photo_metadata_on_commit
from api.metadata.reader import get_metadata, sidecar_files_for_photo
from api.metadata.rights import (
    RIGHTS_FIELDS,
    Keep,
    default_rights,
    is_license,
    replaces,
    resolved,
)
from api.metadata.tags import Tags
from api.metadata.takeout import takeout_metadata_of
from api.models.album_place import AlbumPlace, get_album_place
from api.models.photo import LocationSource, Photo, photo_town
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import (
    IMPORTED_DESCRIPTION_KEY,
    REVERT_ALL,
    MetadataEdit,
    PhotoMetadata,
    description_of,
    fields_edited_by_user_of,
    file_rating_of,
    text_fields_of,
)
from api.models.photo_search import PhotoSearch, place_label
from api.models.tag import Tag, sync_tags_from_keywords, tag_names
from api.models.user import User
from api.places.membership import refresh_photo_places

logger = logging.getLogger(__name__)

# Field names in MetadataEdit rows and in the metadata API.
DATE_TAKEN = "date_taken"
LOCATION = "location"
RATING = "rating"
CAPTION = "caption"
KEYWORDS = "keywords"
# Free-text PhotoMetadata columns a user may set. The scan fills them from the
# file too, but never over a value the user set (``_apply_text_fields``).
TEXT_FIELDS = ("title", "copyright", "creator", "license")
#: The write of a photo's rights (copyright, creator and license, #425) to its
#: file: one ``FIELD_WRITERS`` entry for the three.
RIGHTS = "rights"
# The Photo columns a location edit writes. Not a whole-row save: a job may
# have written other columns since the row was loaded (geolocate_photo).
LOCATION_COLUMNS = [
    "exif_gps_lat",
    "exif_gps_lon",
    "location_source",
    "geolocation_json",
    # Photo.town goes with geolocation_json (the bulk_update below skips save).
    "town",
    "geocoded_lat",
    "geocoded_lon",
    "last_modified",
]

#: Fields whose MetadataEdit rows the revert endpoint can apply.
REVERTIBLE_FIELDS = frozenset(
    {DATE_TAKEN, LOCATION, RATING, CAPTION, KEYWORDS, *TEXT_FIELDS}
)

MAX_RATING = 5


class Change(NamedTuple):
    """One photo's field going from ``old`` to ``new``, for the edit history."""

    photo_id: uuid.UUID
    old: object
    new: object


def _record(user: User, field_name: str, changes: list[Change]) -> None:
    """Record the edit history of ``changes`` and mark their photos changed.

    ``PhotoMetadata.source`` / ``version`` stay the row-level "a user edited
    this photo" flag and counter the API has always shown; the per-field
    source that decides what a rescan may overwrite is #2250.
    """
    if not changes:
        return
    MetadataEdit.objects.bulk_create(
        [
            MetadataEdit(
                photo_id=change.photo_id,
                user=user,
                field_name=field_name,
                old_value=change.old,
                new_value=change.new,
            )
            for change in changes
        ],
        batch_size=500,
    )
    photo_ids = [change.photo_id for change in changes]
    now = timezone.now()
    PhotoMetadata.objects.filter(photo_id__in=photo_ids).update(
        source=PhotoMetadata.Source.USER_EDIT,
        version=F("version") + 1,
        updated_at=now,
    )
    Photo.objects.filter(id__in=photo_ids).update(last_modified=now)


# ---------------------------------------------------------------- capture date


def set_capture_time(photo: Photo, value: datetime | None, user: User) -> None:
    """Pin the photo's capture time to ``value`` (None: no user date).

    ``Photo.timestamp`` is the user's input; it becomes ``exif_timestamp``
    whatever the owner's datetime rules say (#2254), and None hands the photo
    back to the rules. Either way the photo moves to its day album. A changed date is written to the file or sidecar as
    ``XMP:DateCreated``, once, after the commit, when the owner syncs
    metadata to disk.
    """
    old = photo.exif_timestamp
    date_changed = photo.timestamp != value
    photo.timestamp = value
    # A date typed in has no known UTC offset (#2768); without one, the rules
    # give it again.
    photo.exif_timestamp_offset = None
    photo.save()
    if date_changed:
        write_photo_metadata_on_commit(photo, ["timestamp"])
    extract_date_time(photo)
    if photo.exif_timestamp != old:
        _record(user, DATE_TAKEN, [Change(photo.id, old, photo.exif_timestamp)])


class CaptureTimesResult(NamedTuple):
    """What ``set_capture_times`` did: the photos given a new date, and those
    left alone because there was nothing to compute it from."""

    changed: int
    skipped_without_date: int


#: Photos per transaction in ``set_capture_times``: a select-all over a whole
#: library must not hold one long transaction.
CAPTURE_TIME_BATCH_SIZE = 200


def set_capture_times(
    photos: QuerySet[Photo],
    compute_new: Callable[[Photo], datetime | None],
    user: User,
) -> CaptureTimesResult:
    """Give each of ``photos`` the capture time ``compute_new`` returns (#2278).

    What ``set_capture_time`` does for one photo, for many: the new time is the
    user's (``Photo.timestamp``), it becomes ``exif_timestamp`` and moves the
    photo to its day album, and every change goes into the edit history. A
    photo ``compute_new`` returns None for (a shift of a photo without a date)
    keeps its date and is counted as skipped. The photos are changed a batch
    per transaction, and one background job then writes every changed date
    to its file or sidecar when the owner syncs metadata to disk.
    """
    photo_ids = list(photos.order_by().values_list("id", flat=True).distinct())
    count = skipped = 0
    to_write: list[uuid.UUID] = []
    try:
        for start in range(0, len(photo_ids), CAPTURE_TIME_BATCH_SIZE):
            batch = photo_ids[start : start + CAPTURE_TIME_BATCH_SIZE]
            with transaction.atomic():
                result = _set_capture_time_batch(batch, compute_new, user)
            count += result.changed
            skipped += result.skipped_without_date
            to_write += result.written
    finally:
        # The batches committed before a failure are written all the same.
        queue_field_write(user, to_write, DATE_TAKEN)
    return CaptureTimesResult(changed=count, skipped_without_date=skipped)


def shifted_by(delta: timedelta) -> Callable[[Photo], datetime | None]:
    """``compute_new`` of a shift: each photo's date ``delta`` later (earlier
    when negative), so the photos keep their order and spacing. None for a
    photo without a date: there is nothing to shift."""

    def compute(photo: Photo) -> datetime | None:
        if photo.exif_timestamp is None:
            return None
        return photo.exif_timestamp + delta

    return compute


def set_to(value: datetime) -> Callable[[Photo], datetime | None]:
    """``compute_new`` that gives every photo ``value``."""
    return lambda photo: value


class _BatchResult(NamedTuple):
    changed: int
    skipped_without_date: int
    written: list[uuid.UUID]


def _set_capture_time_batch(
    photo_ids: list[uuid.UUID],
    compute_new: Callable[[Photo], datetime | None],
    user: User,
) -> _BatchResult:
    """``set_capture_times`` for one batch, inside its transaction."""
    changes: list[Change] = []
    written: list[uuid.UUID] = []
    count = skipped = 0
    for photo in Photo.objects.filter(id__in=photo_ids).select_related("owner"):
        value = compute_new(photo)
        if value is None:
            skipped += 1
            continue
        count += 1
        old = photo.exif_timestamp
        if photo.timestamp != value:
            written.append(photo.id)
        photo.timestamp = value
        photo.exif_timestamp_offset = None
        extract_date_time(photo, commit=False)
        photo.save(
            update_fields=[
                "timestamp",
                "exif_timestamp",
                "exif_timestamp_offset",
                "exif_timestamp_source",
                "last_modified",
            ]
        )
        if photo.exif_timestamp != old:
            changes.append(Change(photo.id, old, photo.exif_timestamp))
    _record(user, DATE_TAKEN, changes)
    return _BatchResult(count, skipped, written)


# -------------------------------------------------------------------- location


@dataclass(frozen=True)
class LocationsResult:
    """What ``set_locations`` did: the photos it moved, the photos it left
    alone because they had a location, and whether the spot has a place name."""

    count: int
    skipped_with_location: int
    geocoded: bool


def _location_value(photo: Photo) -> dict[str, float] | None:
    if photo.exif_gps_lat is None or photo.exif_gps_lon is None:
        return None
    return {"latitude": photo.exif_gps_lat, "longitude": photo.exif_gps_lon}


def set_location(
    photo: Photo, latitude: float | None, longitude: float | None, user: User
) -> None:
    """Move the photo to ``latitude``, ``longitude``; both None clears it.

    The coordinates are saved even when the geocoder fails; the
    reverse-geocoded place then feeds ``geolocation_json``, the search
    location and the Places albums. Without one the photo has no place
    (``has_place``), not the old one: the geolocation job tries again after a
    failed lookup (geocoding off, an error), not for a position the provider
    has no place for (``no_place``, #2567). The position (or its absence) is the user's
    from now on: a rescan neither replaces nor clears it (#2264). A changed
    position (or a removed one) is written to the file or sidecar (#2290)
    after the commit, whatever the geocoder said.
    """
    if latitude is None or longitude is None:
        old = _location_value(photo)
        _clear_location(photo, LocationSource.USER)
        if old is not None:
            queue_field_write(user, [photo.id], LOCATION)
            _record(user, LOCATION, [Change(photo.id, old, None)])
        return
    _move_and_record([photo], (float(latitude), float(longitude)), user)


def set_locations(
    photos: QuerySet[Photo],
    latitude: float,
    longitude: float,
    user: User,
    overwrite: bool,
) -> LocationsResult:
    """Move many photos to one spot, looked up once (#2279).

    Without ``overwrite`` the photos that already have a location keep it and
    are counted as skipped. Each moved photo gets what ``set_location`` gives
    one photo, the edit history included, in a constant number of queries.
    """
    targets = list(photos.order_by())
    located = [photo for photo in targets if _location_value(photo) is not None]
    if not overwrite:
        targets = [photo for photo in targets if _location_value(photo) is None]
    skipped = 0 if overwrite else len(located)
    if not targets:
        return LocationsResult(count=0, skipped_with_location=skipped, geocoded=False)
    place = _move_and_record(targets, (float(latitude), float(longitude)), user)
    return LocationsResult(
        count=len(targets), skipped_with_location=skipped, geocoded=bool(place)
    )


def _move_and_record(
    photos: list[Photo], position: tuple[float, float], user: User
) -> dict[str, object] | None:
    """Move ``photos`` to ``position`` as the user's edit; return the place.

    The one path of a user's location move, for one photo or many: one
    write-back job (#2290) and one batch of edit history for all ``photos``
    that changed. The job is queued on commit, so a failed lookup does not
    stop it.
    """
    old = {photo.id: _location_value(photo) for photo in photos}
    place = _look_up_place(position)
    _move_photos(photos, position, LocationSource.USER, place)
    changes = [
        Change(photo.id, old[photo.id], new)
        for photo in photos
        if (new := _location_value(photo)) != old[photo.id]
    ]
    queue_field_write(user, [change.photo_id for change in changes], LOCATION)
    _record(user, LOCATION, changes)
    return place


def _look_up_place(position: tuple[float, float]) -> dict[str, object] | None:
    """The reverse-geocoded place at ``position``: a place, ``no_place()``, or
    None when the lookup failed (the geolocation job then tries again)."""
    try:
        geocode_result = reverse_geocode(*position)
    except Exception:
        logger.exception("Reverse geocoding failed for a location edit")
        return None
    if not geocode_result:
        logger.warning("Reverse geocoding failed for a location edit")
        return None
    geocode_result["_v"] = GEOCODE_VERSION
    return geocode_result


def _clear_location(photo: Photo, source: LocationSource) -> None:
    clear_location(photo)
    photo.location_source = source
    photo.save(update_fields=LOCATION_COLUMNS)
    # Out of the user's places (#1365) with its position
    refresh_photo_places([photo])


def _move_photos(
    photos: list[Photo],
    position: tuple[float, float],
    source: LocationSource,
    place: dict[str, object] | None,
) -> None:
    """Give ``photos`` the position and its ``place`` (None: the lookup failed).

    The place of the old coordinates goes with them, whatever the lookup said
    about the new ones (#2253). The Places albums and the search rows are
    updated for all photos at once.
    """
    _leave_album_places(photos)
    now = timezone.now()
    for photo in photos:
        photo.exif_gps_lat, photo.exif_gps_lon = position
        photo.location_source = source
        # A copy each: the photos must not share one mutable dict.
        photo.geolocation_json = dict(place) if place else {}
        photo.town = photo_town(photo.geolocation_json)
        photo.geocoded_lat, photo.geocoded_lon = position if place else (None, None)
        photo.last_modified = now
    Photo.objects.bulk_update(photos, LOCATION_COLUMNS, batch_size=500)
    # Into the user's place at the new position (#1365), whatever the geocoder said
    refresh_photo_places(photos)
    _set_search_locations(photos, place)
    if place:
        _join_album_places(photos, place)


def _leave_album_places(photos: list[Photo]) -> None:
    """Take ``photos`` out of every Places album, in one delete."""
    links = AlbumPlace.photos.through.objects.filter(
        photo_id__in=[photo.id for photo in photos]
    )
    album_ids = set(links.values_list("albumplace_id", flat=True))
    if not album_ids:
        return
    links.delete()
    # A through-table delete leaves the album's last_modified alone, which
    # the mobile delta sync orders by.
    AlbumPlace.objects.filter(id__in=album_ids).update(last_modified=timezone.now())


def _set_search_locations(
    photos: list[Photo], place: Mapping[str, object] | None
) -> None:
    """Index the place name of ``photos`` for search ("" without a place)."""
    label = place_label(dict(place) if place else None)
    rows = {
        row.photo_id: row
        for row in PhotoSearch.objects.filter(photo_id__in=[p.id for p in photos])
    }
    missing = [PhotoSearch(photo=photo) for photo in photos if photo.id not in rows]
    PhotoSearch.objects.bulk_create(missing, batch_size=500)
    searches = [*rows.values(), *missing]
    for search in searches:
        search.search_location = label
        search.refresh_search_folded()
    PhotoSearch.objects.bulk_update(
        searches, ["search_location", "search_folded"], batch_size=500
    )


def _join_album_places(photos: list[Photo], place: Mapping[str, object]) -> None:
    """File ``photos`` under the Places album of each named level of ``place``,
    the album of each owner (one owner unless an admin edits)."""
    features = place.get("features")
    if not isinstance(features, list):
        return
    by_owner: dict[int | None, list[Photo]] = {}
    for photo in photos:
        by_owner.setdefault(photo.owner_id, []).append(photo)
    for owned in by_owner.values():
        owner = owned[0].owner
        for level, feature in enumerate(features):
            if not isinstance(feature, dict) or "text" not in feature:
                continue
            if str(feature["text"]).isnumeric():
                continue
            album_place = get_album_place(str(feature["text"]), owner=owner)
            album_place.geolocation_level = len(features) - level
            album_place.save()
            album_place.photos.add(*owned)


# ---------------------------------------------------------------------- rating


def set_rating(photos: QuerySet[Photo], value: int, user: User) -> int:
    """Give ``photos`` the star rating ``value`` (0 to 5); return the rows set.

    One UPDATE for any number of photos; the write to disk is queued as a
    job (``queue_rating_write``) so it stays off the request. The
    ids and old ratings are read first: a caller's filter on the old rating
    no longer matches afterwards.
    """
    before = list(photos.values_list("id", "rating"))
    if not before:
        return 0
    photo_ids = [photo_id for photo_id, _ in before]
    count = Photo.objects.filter(id__in=photo_ids).update(
        rating=value, last_modified=timezone.now()
    )
    _record(
        user,
        RATING,
        [Change(photo_id, old, value) for photo_id, old in before if old != value],
    )
    queue_rating_write(user, photo_ids)
    return count


# --------------------------------------------------------------------- caption


def set_caption(photo: Photo, text: str, user: User) -> str:
    """Set the photo's caption, the one the lightbox shows; return it as stored.

    It is indexed for search and its #hashtags become hashtag albums
    (``PhotoCaption.apply_user_caption``). A changed caption is written to the
    file or sidecar as its description (#2289).
    """
    stored, changed = _apply_caption(photo, text, user)
    if changed:
        queue_field_write(user, [photo.id], CAPTION)
    return stored


def _apply_caption(photo: Photo, text: str, user: User) -> tuple[str, bool]:
    """``set_caption`` without the write-back; the caption and whether it changed."""
    caption_instance, _ = PhotoCaption.objects.get_or_create(photo=photo)
    old = (caption_instance.captions_json or {}).get("user_caption") or ""
    stored = caption_instance.apply_user_caption(text)
    if stored == old:
        return stored, False
    _record(user, CAPTION, [Change(photo.id, old, stored)])
    return stored, True


# -------------------------------------------------------------------- keywords


def set_keywords(photo: Photo, keywords: list[str] | None, user: User) -> None:
    """Replace the photo's keywords; its tags follow (#2230).

    The edit is kept in ``PhotoMetadata.edited_keywords`` and leaves
    ``PhotoMetadata.keywords`` alone: that is the file's keywords at the last
    read, which a rescan compares with (#2783), so a keyword removed here is
    not new on the next rescan and stays removed, also with "Write edits to
    files" Off. A tag added by hand stays. The tags that changed are written
    to the file or sidecar (#2289).
    """
    changed = _apply_keywords(photo, keywords, user)
    queue_keyword_write(user, [photo.id], changed)


def _apply_keywords(photo: Photo, keywords: list[str] | None, user: User) -> set[str]:
    """``set_keywords`` without the write-back; the tag names that changed."""
    metadata, _ = PhotoMetadata.objects.get_or_create(photo=photo)
    old = _current_keywords(photo, metadata)
    changed = tag_names(old) ^ tag_names(keywords)
    if not changed:
        return set()
    metadata.edited_keywords = keywords
    metadata.save(update_fields=["edited_keywords", "updated_at"])
    sync_tags_from_keywords(photo, keywords, old)
    _record(user, KEYWORDS, [Change(photo.id, old, keywords)])
    return changed


def _current_keywords(photo: Photo, metadata: PhotoMetadata) -> list[str] | None:
    """The photo's keywords as an edit replaces them: its tags that stand for
    a keyword of the file (``keywords``) or of the last keyword edit
    (``edited_keywords``). A tag added by hand is none of them, and a keyword
    whose tag the user removed is gone. Sorted; None for none."""
    names = tag_names(metadata.keywords) | tag_names(metadata.edited_keywords)
    if not names or photo.owner is None:
        return None
    tagged = Tag.objects.owned_by(photo.owner).filter(photos=photo, name__in=names)
    return sorted(tagged.values_list("name", flat=True)) or None


# ------------------------------------------------------------------------ tags


def tags_changed(
    user: User, photo_ids: Iterable[uuid.UUID], names: Collection[str]
) -> None:
    """The tags ``names`` of these photos were added, removed or renamed.

    A tag of LibrePhotos is a keyword of the file (#2230), so each photo's
    file or sidecar gets ``names`` added or removed as the photo has them
    when the write runs (#2289): one job for the whole edit, nothing when the
    owner does not write edits to files. Tags have no edit history yet, so
    nothing is recorded.
    """
    queue_keyword_write(user, list(photo_ids), names)


# ----------------------------------------------------------------- text fields


def set_text_field(photo: Photo, field: str, value: str | None, user: User) -> None:
    """Set ``title``, ``copyright``, ``creator`` or ``license``.

    A changed copyright, creator or license is written to the file or
    sidecar (#425).
    """
    if _apply_text_field(photo, field, value, user) and field in RIGHTS_FIELDS:
        queue_field_write(user, [photo.id], RIGHTS)


def _apply_text_field(photo: Photo, field: str, value: str | None, user: User) -> bool:
    """``set_text_field`` without the write-back; whether the value changed.

    A license is one of ``PhotoLicense`` or None (empty clears it too).
    """
    if field not in TEXT_FIELDS:
        raise ValueError(f"{field} is not a free-text metadata field")
    if field == "license":
        value = value or None
        if value is not None and not is_license(value):
            raise InvalidEditValueError(f"'{value}' is not a license")
    metadata, _ = PhotoMetadata.objects.get_or_create(photo=photo)
    old = getattr(metadata, field)
    if old == value:
        return False
    setattr(metadata, field, value)
    metadata.save(update_fields=[field, "updated_at"])
    _record(user, field, [Change(photo.id, old, value)])
    return True


# ---------------------------------------------------------------------- rights


@dataclass(frozen=True)
class RightsResult:
    """What ``set_rights`` did: the photos it changed, and the photos that
    kept a value it would have replaced (``Keep``)."""

    count: int
    kept: int


#: Photos per transaction in ``set_rights``, as in ``set_capture_times``.
RIGHTS_BATCH_SIZE = 200


def _check_rights_values(values: Mapping[str, str | None]) -> None:
    for field, value in values.items():
        if field not in RIGHTS_FIELDS:
            raise ValueError(f"{field} is not a rights field")
        if field == "license" and value and not is_license(value):
            raise ValueError(f"'{value}' is not a license")


def set_rights(
    photos: QuerySet[Photo],
    values: Mapping[str, str | None],
    keep: Keep,
    user: User,
) -> RightsResult:
    """Give ``photos`` the rights ``values`` (#425), field by field.

    ``values`` maps ``copyright``, ``creator`` and ``license`` to the new
    value (None or "" clears it); a field left out stays as each photo has
    it. A copyright's ``{year}`` becomes each photo's year. Under ``keep`` a
    photo keeps a value it has (``Keep.ANY``) or one its file gives
    (``Keep.FILE``). Each change is an edit in the photo's history, and one
    job writes the changed photos' rights to their files.
    """
    _check_rights_values(values)
    photo_ids = list(photos.order_by().values_list("id", flat=True).distinct())
    changed: list[uuid.UUID] = []
    kept = 0
    try:
        for start in range(0, len(photo_ids), RIGHTS_BATCH_SIZE):
            with transaction.atomic():
                batch_changed, batch_kept = _set_rights_batch(
                    photo_ids[start : start + RIGHTS_BATCH_SIZE], values, keep, user
                )
            changed += batch_changed
            kept += batch_kept
    finally:
        # The batches committed before a failure are written all the same.
        queue_field_write(user, changed, RIGHTS)
    return RightsResult(count=len(changed), kept=kept)


def _metadata_rows(photo_ids: list[uuid.UUID]) -> list[PhotoMetadata]:
    """The ``PhotoMetadata`` of each photo, created where missing, with its photo."""
    existing = set(
        PhotoMetadata.objects.filter(photo_id__in=photo_ids).values_list(
            "photo_id", flat=True
        )
    )
    PhotoMetadata.objects.bulk_create(
        [PhotoMetadata(photo_id=pk) for pk in photo_ids if pk not in existing]
    )
    return list(
        PhotoMetadata.objects.filter(photo_id__in=photo_ids).select_related("photo")
    )


def _rights_changes(
    row: PhotoMetadata,
    values: Mapping[str, str | None],
    keep: Keep,
    edited: Collection[str],
) -> tuple[dict[str, Change], bool]:
    """Set ``values`` on ``row``; the changes by field, and whether ``keep``
    left any of them out."""
    changes: dict[str, Change] = {}
    kept = False
    for field, value in values.items():
        current = getattr(row, field)
        if not replaces(keep, current, field in edited):
            kept = True
            continue
        new = resolved(field, value, row.photo)
        if new != current:
            setattr(row, field, new)
            changes[field] = Change(row.photo_id, current, new)
    return changes, kept


def _set_rights_batch(
    photo_ids: list[uuid.UUID],
    values: Mapping[str, str | None],
    keep: Keep,
    user: User,
) -> tuple[list[uuid.UUID], int]:
    """``set_rights`` for one batch, inside its transaction: the photos
    changed and how many kept a value."""
    edited = fields_edited_by_user_of(photo_ids, RIGHTS_FIELDS)
    by_field: dict[str, list[Change]] = {field: [] for field in values}
    changed_rows: list[PhotoMetadata] = []
    kept = 0
    for row in _metadata_rows(photo_ids):
        changes, row_kept = _rights_changes(
            row, values, keep, edited.get(row.photo_id, set())
        )
        kept += row_kept
        for field, change in changes.items():
            by_field[field].append(change)
        if changes:
            changed_rows.append(row)
    if changed_rows:
        PhotoMetadata.objects.bulk_update(changed_rows, list(values), batch_size=500)
    for field, field_changes in by_field.items():
        _record(user, field, field_changes)
    return [row.photo_id for row in changed_rows], kept


def apply_rights_default(
    photos: QuerySet[Photo], keep: Keep, user: User
) -> RightsResult:
    """Give ``photos`` their owner's default rights (``default_rights``):
    "Apply" in Settings > Metadata. Nothing without a default."""
    values = default_rights(user)
    if not values:
        return RightsResult(count=0, kept=0)
    return set_rights(photos, values, keep, user)


def apply_rights_default_on_scan(photo: Photo) -> None:
    """Fill the rights a newly scanned photo's file does not state from its
    owner's default (#425), as an edit by the owner.

    Not written to the file: a scan never writes to the library. "Write
    metadata to files" or a later edit puts them there.
    """
    owner = photo.owner
    if owner is None:
        return
    values = default_rights(owner)
    if values:
        with transaction.atomic():
            _set_rights_batch([photo.id], values, Keep.ANY, owner)


# ------------------------------------------------- several fields, many photos


def apply_updates(
    photos: QuerySet[Photo], updates: Mapping[str, object], user: User
) -> list[Photo]:
    """Apply validated metadata API ``updates`` to ``photos``; return the photos.

    ``updates`` is the validated data of ``PhotoMetadataUpdateSerializer``:
    ``rating``, ``caption``, ``keywords`` and the text fields.
    """
    targets = list(photos)
    if not targets:
        return targets
    if RATING in updates:
        rating = updates[RATING]
        assert isinstance(rating, int)
        set_rating(Photo.objects.filter(id__in=[p.id for p in targets]), rating, user)
    captioned: list[uuid.UUID] = []
    tagged: list[uuid.UUID] = []
    righted: list[uuid.UUID] = []
    changed_tags: set[str] = set()
    for photo in targets:
        if CAPTION in updates:
            caption = updates[CAPTION]
            assert isinstance(caption, str)
            if _apply_caption(photo, caption, user)[1]:
                captioned.append(photo.id)
        if KEYWORDS in updates:
            keywords = updates[KEYWORDS]
            assert keywords is None or isinstance(keywords, list)
            if changed := _apply_keywords(photo, keywords, user):
                tagged.append(photo.id)
                changed_tags |= changed
        if _apply_text_updates(photo, updates, user):
            righted.append(photo.id)
    # One job writes every changed caption, one every changed tag, one the
    # changed rights.
    queue_field_write(user, captioned, CAPTION)
    queue_keyword_write(user, tagged, changed_tags)
    queue_field_write(user, righted, RIGHTS)
    return targets


def _apply_text_updates(
    photo: Photo, updates: Mapping[str, object], user: User
) -> bool:
    """Apply the text fields of ``updates`` to ``photo``; whether its rights changed."""
    rights_changed = False
    for field in TEXT_FIELDS:
        if field in updates:
            value = updates[field]
            assert value is None or isinstance(value, str)
            changed = _apply_text_field(photo, field, value, user)
            rights_changed |= changed and field in RIGHTS_FIELDS
    return rights_changed


# ---------------------------------------------------------------------- revert


class InvalidEditValueError(ValueError):
    """A stored edit value that cannot be applied to its field."""


def revert_to(photo: Photo, field: str, value: object, user: User) -> None:
    """Set ``field`` back to ``value`` as a ``MetadataEdit`` stored it.

    The revert is itself recorded as an edit. Raises ``InvalidEditValueError`` for
    a value of the wrong shape (a row written before #2252 by hand, say).
    """
    if field == DATE_TAKEN:
        set_capture_time(photo, _as_datetime(value), user)
    elif field == LOCATION:
        latitude, longitude = _as_location(value)
        set_location(photo, latitude, longitude, user)
    elif field == RATING:
        set_rating(Photo.objects.filter(id=photo.id), _as_rating(value), user)
    elif field == CAPTION:
        set_caption(photo, _as_text(value) or "", user)
    elif field == KEYWORDS:
        set_keywords(photo, _as_keywords(value), user)
    elif field in TEXT_FIELDS:
        set_text_field(photo, field, _as_text(value), user)
    else:
        raise InvalidEditValueError(f"an edit of '{field}' cannot be reverted")


def _as_datetime(value: object) -> datetime | None:
    if value is None:
        return None
    if isinstance(value, str):
        parsed = parse_datetime(value)
        if parsed is not None:
            return parsed
    raise InvalidEditValueError("not a date and time")


def _as_location(value: object) -> tuple[float | None, float | None]:
    if value is None:
        return None, None
    if isinstance(value, dict):
        latitude, longitude = value.get("latitude"), value.get("longitude")
        if isinstance(latitude, int | float) and isinstance(longitude, int | float):
            return float(latitude), float(longitude)
    raise InvalidEditValueError("not a location")


def _as_rating(value: object) -> int:
    # A rating edit recorded before #2252 may hold PhotoMetadata's null.
    if value is None:
        return 0
    if isinstance(value, int) and not isinstance(value, bool):
        if 0 <= value <= MAX_RATING:
            return value
    raise InvalidEditValueError("not a rating from 0 to 5")


def _as_text(value: object) -> str | None:
    if value is None or isinstance(value, str):
        return value
    raise InvalidEditValueError("not text")


def _as_keywords(value: object) -> list[str] | None:
    if value is None:
        return None
    if isinstance(value, list) and all(isinstance(item, str) for item in value):
        return value
    raise InvalidEditValueError("not a list of keywords")


# ------------------------------------------------------------------ revert-all


def revert_all(photo: Photo, user: User) -> PhotoMetadata:
    """Restore every user-editable field from the file ("restore from file").

    Re-reads the file (and its sidecar, which is where LibrePhotos writes in
    sidecar mode) and sets each field to what it says, or to empty where it
    says nothing: no user value is left behind. Recorded as one ``_all`` edit.
    Nothing is written back to the file: the values came from it.
    """
    assert photo.main_file is not None
    MetadataEdit.objects.create(
        photo=photo,
        user=user,
        field_name=REVERT_ALL,
        old_value={"action": "revert_all"},
        new_value={"source": PhotoMetadata.Source.EMBEDDED},
    )

    # First, so the date rules below see the file's position.
    _restore_location_from_file(photo)
    values = read_file_values(photo)
    # The keywords before the restore, whose tags the restore takes away:
    # the file's at the last read and those of the last keyword edit.
    previous_keywords = sorted(
        tag_names(previous.keywords) | tag_names(previous.edited_keywords)
        if (previous := PhotoMetadata.objects.filter(photo=photo).first())
        else ()
    )
    # Also stores the file's keywords (``merged_keywords_of``).
    metadata = PhotoMetadata.apply_file_values(photo, values, commit=False)
    assert metadata is not None

    # The file's rating, also as the one last read (#2771), or 0 without one.
    metadata.file_rating = file_rating_of(values)
    photo.rating = metadata.file_rating or 0
    photo.timestamp = None
    extract_date_time(photo, commit=False)
    photo.save()

    file_text = text_fields_of(values)
    for field in TEXT_FIELDS:
        setattr(metadata, field, file_text[field])
    metadata.edited_keywords = None
    metadata.source = PhotoMetadata.Source.EMBEDDED
    metadata.version += 1
    metadata.save()
    sync_tags_from_keywords(photo, metadata.keywords, previous_keywords)

    description = description_of(values)
    caption_instance, _ = PhotoCaption.objects.get_or_create(photo=photo)
    captions = dict(caption_instance.captions_json or {})
    captions.pop(IMPORTED_DESCRIPTION_KEY, None)
    if description:
        captions[IMPORTED_DESCRIPTION_KEY] = description
    caption_instance.captions_json = captions
    # Reindexes search with the restored keywords and caption.
    caption_instance.apply_user_caption(description or "")

    Photo.objects.filter(id=photo.id).update(last_modified=timezone.now())
    return metadata


def _takeout_position(photo: Photo) -> tuple[float, float] | None:
    """The position in the photo's Google Takeout JSON, which the scan uses
    when the file has none (``photo_reader.with_takeout_values``)."""
    takeout = takeout_metadata_of(photo)
    return takeout.position if takeout else None


def _restore_location_from_file(photo: Photo) -> None:
    assert photo.main_file is not None
    latitude, longitude = get_metadata(
        photo.main_file.path,
        tags=[Tags.LATITUDE, Tags.LONGITUDE],
        sidecar_files=sidecar_files_for_photo(photo),
    )
    position = usable_coordinates(latitude, longitude) or _takeout_position(photo)
    if position is None:
        if photo.exif_gps_lat is not None or photo.exif_gps_lon is not None:
            _clear_location(photo, LocationSource.FILE)
        else:
            photo.location_source = LocationSource.FILE
        return
    if (photo.exif_gps_lat, photo.exif_gps_lon) == position:
        photo.location_source = LocationSource.FILE
        return
    _move_photos([photo], position, LocationSource.FILE, _look_up_place(position))
