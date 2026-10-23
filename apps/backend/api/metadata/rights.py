"""A photo's rights (#425): its copyright notice, its creator and its license.

The three live in ``PhotoMetadata`` and are read from the file like the title
(``text_fields_of``); a user's change goes through ``api.metadata.edits``
(``set_text_field`` for one photo, ``set_rights`` for a selection). This
module holds what those need and what the API shows: which values came from
the file, what a selection holds, and the owner's default rights.
"""

from __future__ import annotations

import re
import unicodedata
import uuid
from collections.abc import Collection, Iterable, Mapping
from enum import StrEnum
from typing import TYPE_CHECKING, TypedDict

from django.db.models import Q, QuerySet

from api.models.photo_license import PhotoLicense
from api.models.photo_metadata import PhotoMetadata, fields_edited_by_user_of

if TYPE_CHECKING:
    from api.models.photo import Photo
    from api.models.user import User

#: The rights fields, as ``PhotoMetadata`` columns and edit field names.
RIGHTS_FIELDS = ("copyright", "creator", "license")

#: In a copyright notice set on many photos, the year each was taken.
YEAR_PLACEHOLDER = "{year}"

_LINE_BREAKS = re.compile(r"\s+")


class Keep(StrEnum):
    """What a change of many photos' rights leaves alone.

    ``any``: every value a photo has (only empty fields are filled);
    ``file``: values the photo's file gives (a value set in LibrePhotos is
    replaced); ``none``: nothing, every photo gets the new value.
    """

    ANY = "any"
    FILE = "file"
    NONE = "none"


def replaces(keep: Keep, current: str | None, edited: bool) -> bool:
    """Whether a change under ``keep`` replaces the value ``current``, which
    the user set in LibrePhotos when ``edited`` and the file gave otherwise."""
    if not current or keep is Keep.NONE:
        return True
    return keep is Keep.FILE and edited


def resolved(field: str, value: str | None, photo: Photo) -> str | None:
    """``value`` as ``field`` of ``photo`` stores it: empty is None, and a
    copyright's ``{year}`` becomes the year the photo was taken (added, for a
    photo without a date)."""
    if not value:
        return None
    if field != "copyright" or YEAR_PLACEHOLDER not in value:
        return value
    taken = photo.exif_timestamp or photo.added_on
    return value.replace(YEAR_PLACEHOLDER, str(taken.year))


def single_line(value: str) -> str:
    """``value`` with its line breaks and other control characters as one
    space each run: the ExifTool argument stream refuses line breaks (#2683),
    and a copyright notice is one line."""
    cleaned = "".join(
        " " if unicodedata.category(char) in ("Cc", "Zl", "Zp") else char
        for char in value
    )
    return _LINE_BREAKS.sub(" ", cleaned).strip()


def rights_from_file(metadata: PhotoMetadata) -> list[str]:
    """The rights fields of ``metadata`` whose value is the file's: set, and
    not changed in LibrePhotos since the latest restore from file."""
    edited = fields_edited_by_user_of([metadata.photo_id], RIGHTS_FIELDS).get(
        metadata.photo_id, set()
    )
    return [
        field
        for field in RIGHTS_FIELDS
        if getattr(metadata, field) and field not in edited
    ]


class FieldSummary(TypedDict):
    """One rights field of a selection: its value when every photo has the
    same one, ``mixed`` when they differ."""

    value: str | None
    mixed: bool


class RightsSummary(TypedDict):
    """What a selection's rights are before "Set rights…" changes them."""

    count: int
    from_file: int
    copyright: FieldSummary
    creator: FieldSummary
    license: FieldSummary


def _field_summary(values: Iterable[str | None]) -> FieldSummary:
    distinct = {value or None for value in values}
    if len(distinct) > 1:
        return {"value": None, "mixed": True}
    return {"value": next(iter(distinct), None), "mixed": False}


def _from_file(values: tuple[str | None, ...], edited: Collection[str]) -> bool:
    return any(
        value and field not in edited
        for field, value in zip(RIGHTS_FIELDS, values, strict=True)
    )


def rights_summary(photos: QuerySet[Photo]) -> RightsSummary:
    """The rights of ``photos``: each field's common value (or that it is
    mixed) and how many photos have a value from their file."""
    ids = photos.order_by().values_list("id", flat=True).distinct()
    by_photo: dict[uuid.UUID, tuple[str | None, ...]] = {
        photo_id: tuple(values)
        for photo_id, *values in PhotoMetadata.objects.filter(
            photo_id__in=ids
        ).values_list("photo_id", *RIGHTS_FIELDS)
    }
    count = ids.count()
    edited = fields_edited_by_user_of(ids, RIGHTS_FIELDS)
    without_row = [(None, None, None)] * (count - len(by_photo))
    rows = [*by_photo.values(), *without_row]
    copyright_, creator, license_ = (
        _field_summary(row[index] for row in rows)
        for index in range(len(RIGHTS_FIELDS))
    )
    return {
        "count": count,
        "from_file": sum(
            _from_file(values, edited.get(photo_id, ()))
            for photo_id, values in by_photo.items()
        ),
        "copyright": copyright_,
        "creator": creator,
        "license": license_,
    }


class PhotoRightsData(TypedDict):
    """A photo's rights as other people see them (``PhotoRightsSerializer``)."""

    license: str | None
    creator: str | None
    copyright: str | None


def rights_of(metadata: PhotoMetadata | None) -> PhotoRightsData | None:
    """The rights ``metadata`` states, or None when it states none (#425).

    Users who see the photo get it whole; a public page's visitor only when
    the photo has a license (``api.sharing.grants.licensed_rights``).
    """
    if metadata is None:
        return None
    rights: PhotoRightsData = {
        "license": metadata.license or None,
        "creator": metadata.creator or None,
        "copyright": metadata.copyright or None,
    }
    return rights if any(rights.values()) else None


def default_rights(user: User) -> dict[str, str]:
    """The rights ``user`` gives their photos, by field; a field without a
    default is left out."""
    defaults = {
        "copyright": user.default_copyright.strip(),
        "creator": user.default_creator.strip(),
        "license": user.default_license or "",
    }
    return {field: value for field, value in defaults.items() if value}


def missing_any(fields: Iterable[str]) -> Q:
    """Photos without a value in any of ``fields`` (or without metadata)."""
    condition = Q(pk__in=[])
    for field in fields:
        condition |= Q(**{f"metadata__{field}__isnull": True})
        condition |= Q(**{f"metadata__{field}": ""})
    return condition


def is_license(value: object) -> bool:
    """Whether ``value`` is one of the licenses LibrePhotos knows."""
    return value in PhotoLicense.values


def as_values(data: Mapping[str, object]) -> dict[str, str | None]:
    """The rights fields a validated request sets, by field (None clears)."""
    return {
        field: value if isinstance(value, str) else None
        for field, value in data.items()
        if field in RIGHTS_FIELDS
    }
