"""The body of a zip download (``POST /api/photos/download``) and its poll.

The download takes a JSON body or a form, and was always lenient about its
shape: a single string stands for a list of one hash, a flag is read by its
spelling, and a ``query`` sent as a list is its first item. The fields below
keep that, so only a value of the wrong kind altogether is a 400.
"""

from typing import Any

from drf_spectacular.types import OpenApiTypes
from drf_spectacular.utils import extend_schema_field
from rest_framework import serializers

from api.drf.params import JsonStringField

_TRUE_WORDS = frozenset({"1", "true", "yes", "on"})


@extend_schema_field(OpenApiTypes.BOOL)
class _DownloadFlagField(serializers.Field[bool, object, bool, Any]):
    """A flag sent as a JSON boolean or as text (``1``, ``true``, ``yes``, ``on``).

    Any other text is false, a list counts as its first item, and any other
    value by its truthiness. It never fails.
    """

    def __init__(self, *, help_text: str | None = None) -> None:
        super().__init__(default=False, allow_null=True, help_text=help_text)

    def validate_empty_values(self, data: object) -> tuple[bool, object]:
        if data is None:
            return (True, False)
        return super().validate_empty_values(data)

    def to_internal_value(self, data: object) -> bool:
        if isinstance(data, (list, tuple)):
            data = data[0] if data else False
        if isinstance(data, str):
            return data.strip().lower() in _TRUE_WORDS
        return bool(data)

    def to_representation(self, value: bool) -> bool:
        return value


class _HashListField(serializers.ListField):
    """A list of image hashes; a single string is a list of one."""

    def __init__(self, *, help_text: str | None = None, **kwargs: Any) -> None:
        super().__init__(
            child=JsonStringField(), allow_null=True, help_text=help_text, **kwargs
        )

    def to_internal_value(self, data: list[Any] | str) -> list[str]:
        if isinstance(data, str):
            data = [data]
        return super().to_internal_value(data)


class _PhotoQueryField(serializers.DictField):
    """The select-all photo filter; a list stands for its first item."""

    def __init__(self, *, help_text: str | None = None) -> None:
        super().__init__(default=dict, allow_null=True, help_text=help_text)

    def to_internal_value(
        self, data: dict[Any, Any] | list[Any] | tuple[Any, ...]
    ) -> dict[str, Any]:
        if isinstance(data, (list, tuple)):
            data = data[0] if data else {}
        return super().to_internal_value(data)


class ZipDownloadRequest(serializers.Serializer[None]):
    """The photos to archive: ``image_hashes``, or ``select_all`` with a ``query``.

    Like the other bulk actions (``PhotoSelectionRequest``): the ``query`` is
    the filter of ``api.photos.selection.build_photo_queryset``, minus
    ``excluded_hashes``.
    """

    select_all = _DownloadFlagField(help_text="Archive every photo the query matches")
    query = _PhotoQueryField(help_text="The photo filter, with select_all")
    excluded_hashes = _HashListField(
        default=list,
        help_text="Photos the query matches that are left out, with select_all",
    )
    image_hashes = _HashListField(
        required=False, help_text="The photos, without select_all"
    )
    include_stacked_photos = _DownloadFlagField(
        help_text="Also archive the other photos of their stacks"
    )

    def validate(self, attrs: dict[str, Any]) -> dict[str, Any]:
        if not attrs["select_all"] and not attrs.get("image_hashes"):
            raise serializers.ValidationError({"image_hashes": "image_hashes required"})
        attrs["query"] = attrs["query"] or {}
        attrs["excluded_hashes"] = attrs["excluded_hashes"] or []
        return attrs


class ZipDownloadStatusQuery(serializers.Serializer[None]):
    """Polling a download job."""

    job_id = serializers.CharField(
        error_messages={
            "required": "job_id is required",
            "blank": "job_id is required",
        },
        help_text="The job_id the download answered",
    )


class ZipDownloadStartedSerializer(serializers.Serializer[None]):
    """``POST /api/photos/download``: the archive job."""

    job_id = serializers.CharField(help_text="The job to poll")
    url = serializers.UUIDField(
        help_text="The archive's name, for /media/zip/ and /api/delete/zip/"
    )


class ZipDownloadFinishedSerializer(serializers.Serializer[None]):
    """``GET /api/photos/download?job_id=`` (200): the job is over."""

    status = serializers.CharField(
        help_text="SUCCESS, or FAILURE for a failed or cancelled job"
    )
    result = serializers.JSONField(
        required=False,
        allow_null=True,
        help_text="With FAILURE: the job's result, which says what went wrong",
    )


class ZipDownloadPendingSerializer(serializers.Serializer[None]):
    """``GET /api/photos/download?job_id=`` (202): the job still runs."""

    status = serializers.CharField(help_text="PENDING")
    progress = serializers.JSONField(
        allow_null=True, help_text="The job's progress so far, null before any"
    )
