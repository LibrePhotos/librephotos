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
keywords                   ``PhotoMetadata.keywords``, projected onto ``Tag``
title, copyright, creator  ``PhotoMetadata``
=========================  ===================================================

A setter writes the store, records a ``MetadataEdit`` per changed photo (the
edit history that revert works from), bumps ``Photo.last_modified`` so the
mobile delta feed and the clients' caches see the change, refreshes
``PhotoSearch`` where the field is indexed, and writes the value back to the
file or sidecar when the owner syncs metadata to disk. Write-back covers the
rating, the capture date, the caption, the keywords (#2289) and the location
(#2290); the text fields are not written to files yet. Tags are the keywords
the user edits (#2230): ``tags_changed`` writes the tags an edit of the tag
endpoints touched, which have no edit history.

``PhotoMetadata`` otherwise holds what the file says (camera, lens, exposure,
size) and is filled by the scan, not by these setters.
"""

from __future__ import annotations

import logging
import uuid
from collections.abc import Collection, Iterable, Mapping
from datetime import datetime
from typing import NamedTuple

from django.db.models import F, QuerySet
from django.utils import timezone
from django.utils.dateparse import parse_datetime

from api.geocode import GEOCODE_VERSION
from api.geocode.geocode import reverse_geocode
from api.geocode.photo_location import (
    clear_location,
    find_album_places,
    forget_place,
    usable_coordinates,
)
from api.metadata.jobs import (
    queue_field_write,
    queue_keyword_write,
    queue_rating_write,
)
from api.metadata.photo_datetime import extract_date_time
from api.metadata.photo_reader import read_file_values
from api.metadata.photo_writer import write_photo_metadata_on_commit
from api.metadata.reader import get_metadata, sidecar_files_for_photo
from api.metadata.tags import Tags
from api.models.album_place import get_album_place
from api.models.photo import LocationSource, Photo
from api.models.photo_caption import PhotoCaption
from api.models.photo_metadata import (
    IMPORTED_DESCRIPTION_KEY,
    REVERT_ALL,
    MetadataEdit,
    PhotoMetadata,
    description_of,
    merged_keywords_of,
    text_fields_of,
)
from api.models.photo_search import PhotoSearch
from api.models.tag import sync_tags_from_keywords, tag_names
from api.models.user import User

logger = logging.getLogger(__name__)

# Field names in MetadataEdit rows and in the metadata API.
DATE_TAKEN = "date_taken"
LOCATION = "location"
RATING = "rating"
CAPTION = "caption"
KEYWORDS = "keywords"
# Free-text PhotoMetadata columns a user may set. The scan fills them from the
# file too, but never over a value the user set (``_apply_text_fields``).
TEXT_FIELDS = ("title", "copyright", "creator")
# The Photo columns a location edit writes. Not a whole-row save: a job may
# have written other columns since the row was loaded (geolocate_photo).
LOCATION_COLUMNS = [
    "exif_gps_lat",
    "exif_gps_lon",
    "location_source",
    "geolocation_json",
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


def _recreate_search_captions(photo: Photo) -> None:
    search_instance, _ = PhotoSearch.objects.get_or_create(photo=photo)
    search_instance.recreate_search_captions()
    search_instance.save()


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
    photo.save()
    if date_changed:
        write_photo_metadata_on_commit(photo, ["timestamp"])
    extract_date_time(photo)
    if photo.exif_timestamp != old:
        _record(user, DATE_TAKEN, [Change(photo.id, old, photo.exif_timestamp)])


# -------------------------------------------------------------------- location


def _location_value(photo: Photo) -> dict[str, float] | None:
    if photo.exif_gps_lat is None or photo.exif_gps_lon is None:
        return None
    return {"latitude": photo.exif_gps_lat, "longitude": photo.exif_gps_lon}


def set_location(
    photo: Photo, latitude: float | None, longitude: float | None, user: User
) -> None:
    """Move the photo to ``latitude``, ``longitude``; both None clears it.

    The coordinates are saved first, so a geocoder failure still keeps them;
    the reverse-geocoded place then feeds ``geolocation_json``, the search
    location and the Places albums. Without one the photo has no place
    (``has_place``), not the old one: the geolocation job tries again after a
    failed lookup (geocoding off, an error), not for a position the provider
    has no place for (``no_place``, #2567). The position (or its absence) is the user's
    from now on: a rescan neither replaces nor clears it (#2264). A changed
    position is written to the file or sidecar (#2290), queued before the
    geocoder runs, so its failure does not stop the write.
    """
    old = _location_value(photo)
    has_position = _save_position(photo, latitude, longitude, LocationSource.USER)
    new = _location_value(photo)
    if new != old:
        queue_field_write(user, [photo.id], LOCATION)
    if has_position:
        _geocode_position(photo)
    if new != old:
        _record(user, LOCATION, [Change(photo.id, old, new)])


def _apply_location(
    photo: Photo,
    latitude: float | None,
    longitude: float | None,
    source: LocationSource,
) -> None:
    if _save_position(photo, latitude, longitude, source):
        _geocode_position(photo)


def _save_position(
    photo: Photo,
    latitude: float | None,
    longitude: float | None,
    source: LocationSource,
) -> bool:
    """Save the position (None: no location); whether there is one to geocode."""
    if latitude is None or longitude is None:
        clear_location(photo)
        photo.location_source = source
        photo.save(update_fields=LOCATION_COLUMNS)
        return False

    # The place of the old coordinates goes with them, whatever the geocoder
    # says about the new ones (#2253).
    forget_place(photo, find_album_places(photo))
    photo.geocoded_lat = photo.geocoded_lon = None
    photo.exif_gps_lat = float(latitude)
    photo.exif_gps_lon = float(longitude)
    photo.location_source = source
    # Saved before the geocoder runs, so its failure still keeps them.
    photo.save(update_fields=LOCATION_COLUMNS)
    return True


def _geocode_position(photo: Photo) -> None:
    """Find the place of the saved position for the map, search and Places."""
    assert photo.exif_gps_lat is not None and photo.exif_gps_lon is not None
    try:
        geocode_result = reverse_geocode(photo.exif_gps_lat, photo.exif_gps_lon)
    except Exception:
        logger.exception("Reverse geocoding failed for photo %s", photo.image_hash)
        return
    if not geocode_result:
        logger.warning("Reverse geocoding failed for photo %s", photo.image_hash)
        return

    geocode_result["_v"] = GEOCODE_VERSION
    photo.geolocation_json = geocode_result
    photo.geocoded_lat, photo.geocoded_lon = photo.exif_gps_lat, photo.exif_gps_lon
    _update_search_location(photo, geocode_result)
    _add_to_album_places(photo, geocode_result)
    photo.save(update_fields=LOCATION_COLUMNS)


def _update_search_location(
    photo: Photo, geocode_result: dict[str, object] | None
) -> None:
    search_instance, _ = PhotoSearch.objects.get_or_create(photo=photo)
    search_instance.update_search_location(geocode_result)
    search_instance.save()


def _add_to_album_places(photo: Photo, geocode_result: Mapping[str, object]) -> None:
    features = geocode_result.get("features")
    if not isinstance(features, list):
        return
    for geolocation_level, feature in enumerate(features):
        if not isinstance(feature, dict) or "text" not in feature:
            continue
        if str(feature["text"]).isnumeric():
            continue
        album_place = get_album_place(feature["text"], owner=photo.owner)
        if not album_place.photos.filter(image_hash=photo.image_hash).exists():
            album_place.geolocation_level = len(features) - geolocation_level
        album_place.photos.add(photo)
        album_place.save()


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
    """Replace the photo's keywords; the tags and the search index follow.

    The tags that changed are written to the file or sidecar (#2289).
    """
    changed = _apply_keywords(photo, keywords, user)
    queue_keyword_write(user, [photo.id], changed)


def _apply_keywords(photo: Photo, keywords: list[str] | None, user: User) -> set[str]:
    """``set_keywords`` without the write-back; the tag names that changed."""
    metadata, _ = PhotoMetadata.objects.get_or_create(photo=photo)
    old = metadata.keywords
    if old == keywords:
        return set()
    metadata.keywords = keywords
    metadata.save(update_fields=["keywords", "updated_at"])
    sync_tags_from_keywords(photo, keywords, old)
    _recreate_search_captions(photo)
    _record(user, KEYWORDS, [Change(photo.id, old, keywords)])
    return tag_names(old) ^ tag_names(keywords)


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
    """Set ``title``, ``copyright`` or ``creator``."""
    if field not in TEXT_FIELDS:
        raise ValueError(f"{field} is not a free-text metadata field")
    metadata, _ = PhotoMetadata.objects.get_or_create(photo=photo)
    old = getattr(metadata, field)
    if old == value:
        return
    setattr(metadata, field, value)
    metadata.save(update_fields=[field, "updated_at"])
    _record(user, field, [Change(photo.id, old, value)])


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
        for field in TEXT_FIELDS:
            if field in updates:
                value = updates[field]
                assert value is None or isinstance(value, str)
                set_text_field(photo, field, value, user)
    # One job writes every changed caption, one every changed tag.
    queue_field_write(user, captioned, CAPTION)
    queue_keyword_write(user, tagged, changed_tags)
    return targets


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
    metadata = PhotoMetadata.apply_file_values(photo, values, commit=False)
    assert metadata is not None

    rating = values.get("rating")
    photo.rating = (
        rating if isinstance(rating, int) and not isinstance(rating, bool) else 0
    )
    photo.timestamp = None
    extract_date_time(photo, commit=False)
    photo.save()

    previous_keywords = metadata.keywords
    metadata.keywords = merged_keywords_of(values) or None
    file_text = text_fields_of(values)
    for field in TEXT_FIELDS:
        setattr(metadata, field, file_text[field])
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


def _restore_location_from_file(photo: Photo) -> None:
    assert photo.main_file is not None
    latitude, longitude = get_metadata(
        photo.main_file.path,
        tags=[Tags.LATITUDE, Tags.LONGITUDE],
        sidecar_files=sidecar_files_for_photo(photo),
    )
    position = usable_coordinates(latitude, longitude)
    if position is None:
        if photo.exif_gps_lat is not None or photo.exif_gps_lon is not None:
            _apply_location(photo, None, None, LocationSource.FILE)
        else:
            photo.location_source = LocationSource.FILE
        return
    if (photo.exif_gps_lat, photo.exif_gps_lon) == position:
        photo.location_source = LocationSource.FILE
        return
    _apply_location(photo, *position, LocationSource.FILE)
