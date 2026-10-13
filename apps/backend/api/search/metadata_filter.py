"""Structured photo filters: camera, lens, exposure, rating, date, location,
file type and people (#2259, #329).

Search (``api.search.filters.SemanticSearchFilter``) and server-side "Select
All" (``api.photos.selection.build_photo_queryset``) read the same parameters
through ``MetadataFilterQuery`` and turn them into the same ``Q`` objects with
``metadata_filter_q``, so a select-all after a filtered search acts on exactly
the photos it listed. Every parameter is optional and they combine with AND.

The query serializer lives here rather than in ``api/serializers/``: both of
its readers are domain modules, which may not import the serializer layer
(``lint-imports``). Views name it in ``@extend_schema(parameters=[...])``.

Date, location and rating filter on ``Photo`` columns (``exif_timestamp``,
``exif_gps_lat``/``exif_gps_lon``, ``rating``), the camera and exposure filters
on ``PhotoMetadata``, a one-to-one relation, so none of them repeats a photo.
The people filter is one ``EXISTS`` per person, so it needs no ``distinct()``.
"""

from __future__ import annotations

import datetime
from collections.abc import Mapping
from typing import Any, TypedDict

from django.contrib.auth.models import AnonymousUser
from django.db.models import Count, Exists, OuterRef, Q
from django.utils import timezone
from rest_framework import serializers
from rest_framework.fields import empty

from api.mime import IMAGE_EXTENSIONS, RAW_EXTENSIONS, VIDEO_EXTENSIONS
from api.models import Face, File, Photo, User
from api.models.person import Person

#: ``file_type`` values: ``raw`` is a photo with a RAW file among its files
#: (the RAW badge on a tile), the others the type of its main file.
FILE_TYPES = ("image", "raw", "video")
MAIN_FILE_TYPES = {"image": File.IMAGE, "video": File.VIDEO}
MEDIA_EXTENSIONS = IMAGE_EXTENSIONS | VIDEO_EXTENSIONS | RAW_EXTENSIONS

#: Text parameters matched exactly, ignoring case, against PhotoMetadata.
TEXT_FILTERS = (
    ("camera", "metadata__camera_model__iexact"),
    ("make", "metadata__camera_make__iexact"),
    ("lens", "metadata__lens_model__iexact"),
)
#: Inclusive ranges: (lowest parameter, highest parameter, column).
RANGE_FILTERS = (
    ("iso_min", "iso_max", "metadata__iso"),
    ("aperture_min", "aperture_max", "metadata__aperture"),
    ("focal_min", "focal_max", "metadata__focal_length"),
    ("focal35_min", "focal35_max", "metadata__focal_length_35mm"),
)
#: The most people one search may ask for at once.
MAX_PEOPLE = 20


def no_location_q() -> Q:
    """Photos without a position: a missing latitude or longitude.

    A photo whose coordinates did not reverse geocode still has a location,
    so ``geolocation_json`` plays no part. The "Without Location" list
    (``/api/photos/nolocation/``) and ``has_location=false`` share it.
    """
    return Q(exif_gps_lat__isnull=True) | Q(exif_gps_lon__isnull=True)


def has_location_q() -> Q:
    """Photos with both coordinates: the complement of ``no_location_q``."""
    return Q(exif_gps_lat__isnull=False) & Q(exif_gps_lon__isnull=False)


class StrictFlagField(serializers.BooleanField):
    """An optional yes/no: absent means "no filter", anything unknown is a 400.

    ``serializers.BooleanField`` reads an absent query flag as false.
    """

    default_empty_html = empty

    def __init__(self, *, help_text: str | None = None) -> None:
        super().__init__(required=False, help_text=help_text)


class PersonIdsField(serializers.ListField):
    """Person ids: a repeated query parameter (``?person=1&person=2``) or, in
    a select-all ``query``, a list or one id (the person page sends one)."""

    def __init__(self, *, help_text: str | None = None) -> None:
        super().__init__(
            child=serializers.IntegerField(min_value=1),
            required=False,
            allow_empty=False,
            max_length=MAX_PEOPLE,
            help_text=help_text,
        )

    def to_internal_value(self, data: list[Any] | int | str) -> list[int]:
        if isinstance(data, (int, str)):
            data = [data]
        return list(dict.fromkeys(super().to_internal_value(data)))


class MetadataFilterQuery(serializers.Serializer[None]):
    """The structured filters of search and of a select-all ``query``.

    Ranges are inclusive and a lowest value above its highest is a 400.
    ``taken_after`` / ``taken_before`` are whole days (the server's time
    zone) on the capture time; a photo without one never matches them.
    Needs ``context={"user": ...}``: every person must be one of the user's.
    """

    camera = serializers.CharField(
        required=False,
        max_length=100,
        help_text="Camera model, exact match ignoring case (values: metadata-values?field=camera)",
    )
    make = serializers.CharField(
        required=False,
        max_length=100,
        help_text="Camera maker, exact match ignoring case (values: metadata-values?field=make)",
    )
    lens = serializers.CharField(
        required=False,
        max_length=100,
        help_text="Lens model, exact match ignoring case (values: metadata-values?field=lens)",
    )
    iso_min = serializers.IntegerField(
        required=False, min_value=0, help_text="Lowest ISO speed"
    )
    iso_max = serializers.IntegerField(
        required=False, min_value=0, help_text="Highest ISO speed"
    )
    aperture_min = serializers.FloatField(
        required=False, min_value=0, help_text="Lowest f-number"
    )
    aperture_max = serializers.FloatField(
        required=False, min_value=0, help_text="Highest f-number"
    )
    focal_min = serializers.FloatField(
        required=False, min_value=0, help_text="Shortest focal length in mm"
    )
    focal_max = serializers.FloatField(
        required=False, min_value=0, help_text="Longest focal length in mm"
    )
    focal35_min = serializers.IntegerField(
        required=False,
        min_value=0,
        help_text="Shortest 35 mm equivalent focal length in mm",
    )
    focal35_max = serializers.IntegerField(
        required=False,
        min_value=0,
        help_text="Longest 35 mm equivalent focal length in mm",
    )
    rating_min = serializers.IntegerField(
        required=False,
        min_value=1,
        max_value=5,
        help_text="At least this many stars (1-5)",
    )
    taken_after = serializers.DateField(
        required=False, help_text="Taken on or after this day (YYYY-MM-DD)"
    )
    taken_before = serializers.DateField(
        required=False, help_text="Taken on or before this day (YYYY-MM-DD)"
    )
    has_location = StrictFlagField(
        help_text="true: only photos with GPS coordinates; false: only photos without"
    )
    file_type = serializers.ChoiceField(
        choices=FILE_TYPES,
        required=False,
        help_text="image or video: the main file's type; raw: has a RAW file",
    )
    extension = serializers.CharField(
        required=False,
        max_length=10,
        help_text="The main file's extension, with or without the dot",
    )
    person = PersonIdsField(
        help_text="Repeat for several people: only photos showing all of them"
    )

    def validate_extension(self, value: str) -> str:
        normalized = "." + value.strip().lower().lstrip(".")
        if normalized not in MEDIA_EXTENSIONS:
            raise serializers.ValidationError(f"Unknown media file extension: {value}")
        return normalized

    def validate_person(self, value: list[int]) -> list[int]:
        user: User | AnonymousUser | None = self.context.get("user")
        known = set(
            Person.objects.owned_by(user)
            .filter(id__in=value)
            .values_list("id", flat=True)
        )
        unknown = [str(person_id) for person_id in value if person_id not in known]
        if unknown:
            raise serializers.ValidationError(f"Unknown person: {', '.join(unknown)}")
        return value

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        bounds = [(low, high) for low, high, _ in RANGE_FILTERS]
        bounds.append(("taken_after", "taken_before"))
        errors = {
            high: f"Must not be below {low}."
            for low, high in bounds
            if low in attrs and high in attrs and attrs[low] > attrs[high]
        }
        if errors:
            raise serializers.ValidationError(errors)
        return attrs


def parse_metadata_filter(
    user: User | AnonymousUser | None,
    data: Mapping[str, Any],
    nested_under: str | None = None,
) -> dict[str, Any]:
    """``data`` validated by ``MetadataFilterQuery``; a 400 naming the field.

    ``data`` is a query string or a select-all ``query``; other keys in it are
    ignored. With ``nested_under`` the errors are reported under that field
    (``query`` for a select-all body).
    """
    serializer = MetadataFilterQuery(data=data, context={"user": user})
    if not serializer.is_valid():
        errors = serializer.errors
        raise serializers.ValidationError(
            {nested_under: errors} if nested_under else errors
        )
    return dict(serializer.validated_data)


def _day_start(day: datetime.date) -> datetime.datetime:
    return datetime.datetime.combine(
        day, datetime.time.min, tzinfo=timezone.get_current_timezone()
    )


def _taken_q(filters: Mapping[str, Any]) -> list[Q]:
    """Whole days, as half-open bounds on the column so its index serves."""
    found = []
    if "taken_after" in filters:
        found.append(Q(exif_timestamp__gte=_day_start(filters["taken_after"])))
    if "taken_before" in filters:
        next_day = filters["taken_before"] + datetime.timedelta(days=1)
        found.append(Q(exif_timestamp__lt=_day_start(next_day)))
    return found


def _range_q(filters: Mapping[str, Any]) -> list[Q]:
    found = []
    for low, high, column in RANGE_FILTERS:
        if low in filters:
            found.append(Q(**{f"{column}__gte": filters[low]}))
        if high in filters:
            found.append(Q(**{f"{column}__lte": filters[high]}))
    return found


def _file_q(filters: Mapping[str, Any]) -> list[Q]:
    found = []
    file_type = filters.get("file_type")
    if file_type == "raw":
        raw_files = Photo.files.through.objects.filter(
            photo_id=OuterRef("pk"), file__type=File.RAW_FILE
        )
        found.append(Q(main_file__type=File.RAW_FILE) | Q(Exists(raw_files)))
    elif file_type is not None:
        found.append(Q(main_file__type=MAIN_FILE_TYPES[file_type]))
    if "extension" in filters:
        found.append(Q(main_file__path__iendswith=filters["extension"]))
    return found


def people_q(person_ids: list[int]) -> list[Q]:
    """Photos showing every one of ``person_ids``: one ``EXISTS`` each.

    A deleted face no longer shows its person. The ids must already be the
    requester's people (``MetadataFilterQuery.validate_person``).
    """
    return [
        Q(
            Exists(
                Face.objects.filter(
                    photo_id=OuterRef("pk"), person_id=person_id, deleted=False
                )
            )
        )
        for person_id in person_ids
    ]


def metadata_filter_q(filters: Mapping[str, Any]) -> list[Q]:
    """The ``Q`` objects for validated ``filters`` (``parse_metadata_filter``).

    Pass them all to one ``filter()`` call on a photo queryset.
    """
    found = [
        Q(**{lookup: filters[param]})
        for param, lookup in TEXT_FILTERS
        if param in filters
    ]
    found += _range_q(filters)
    if "rating_min" in filters:
        found.append(Q(rating__gte=filters["rating_min"]))
    found += _taken_q(filters)
    if "has_location" in filters:
        found.append(has_location_q() if filters["has_location"] else no_location_q())
    found += _file_q(filters)
    found += people_q(filters.get("person", []))
    return found


#: ``metadata-values`` fields and the PhotoMetadata column each lists.
VALUE_COLUMNS = {
    "camera": "metadata__camera_model",
    "make": "metadata__camera_make",
    "lens": "metadata__lens_model",
}


class MetadataValue(TypedDict):
    value: str
    count: int


def metadata_values(
    user: User | AnonymousUser | None, field: str
) -> list[MetadataValue]:
    """The distinct non-blank values of ``field`` on ``user``'s visible photos,
    with how many photos carry each, most photos first (one query).

    The photos are the ones search looks through (``Photo.visible``), so a
    suggested value always finds something.
    """
    column = VALUE_COLUMNS[field]
    rows = (
        Photo.visible.owned_by(user)
        .filter(**{f"{column}__gt": ""})
        .values(column)
        .annotate(count=Count("pk"))
        .order_by("-count", column)
    )
    return [MetadataValue(value=row[column], count=row["count"]) for row in rows]
