"""Request input and answers of the duplicate views (``api/views/duplicates.py``).

The answers are only for the OpenAPI schema: the views build the dicts.
"""

from rest_framework import serializers

from api.drf.params import ClampedIntegerField
from api.models.duplicate import Duplicate
from api.serializers.photo_groups import (
    GroupPhotoSerializer,
    LegacyFlagsPageSerializer,
    PhotoGroupThumbnailSerializer,
)


class DuplicateListQuery(serializers.Serializer[None]):
    """The filters; ``page``/``page_size`` are the paginator's (api/drf/pagination.py)."""

    duplicate_type = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Filter by duplicate type: exact_copy, visual_duplicate",
    )
    status = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Filter by review status: pending, resolved, dismissed",
    )


class DuplicateResolveRequest(serializers.Serializer[None]):
    keep_photo_hash = serializers.CharField(
        help_text="image_hash of the photo to keep; it must be in the group"
    )
    trash_others = serializers.BooleanField(
        default=True, help_text="Move the group's other photos to the trash"
    )


class DetectDuplicatesRequest(serializers.Serializer[None]):
    detect_exact_copies = serializers.BooleanField(
        default=True, help_text="Detect exact file copies"
    )
    detect_visual_duplicates = serializers.BooleanField(
        default=True, help_text="Detect visually similar photos"
    )
    visual_threshold = serializers.IntegerField(
        default=10, help_text="Hamming distance threshold for visual duplicates"
    )
    clear_pending = serializers.BooleanField(
        default=False,
        help_text="Clear existing pending duplicates before detection",
    )
    batch_size = ClampedIntegerField(
        default=10000,
        lowest=100,
        highest=50000,
        help_text="Photos per batch for visual detection (100 to 50000)",
    )


class DuplicateListItemSerializer(serializers.Serializer[None]):
    """A row of ``GET /api/duplicates/``."""

    id = serializers.UUIDField()
    duplicate_type = serializers.ChoiceField(choices=Duplicate.DuplicateType.choices)
    duplicate_type_display = serializers.CharField()
    review_status = serializers.ChoiceField(choices=Duplicate.ReviewStatus.choices)
    review_status_display = serializers.CharField()
    photo_count = serializers.IntegerField()
    potential_savings = serializers.IntegerField(
        help_text="Bytes freed by trashing all but the kept photo"
    )
    similarity_score = serializers.FloatField(
        allow_null=True, help_text="Visual duplicates: 0 to 1, higher is more similar"
    )
    created_at = serializers.DateTimeField()
    kept_photo = PhotoGroupThumbnailSerializer(allow_null=True)
    preview_photos = PhotoGroupThumbnailSerializer(
        many=True, help_text="The first four photos"
    )


class DuplicatePageSerializer(LegacyFlagsPageSerializer):
    """A page of ``GET /api/duplicates/``: groups with at least 2 photos, newest first."""

    results = DuplicateListItemSerializer(many=True)


class DuplicatePhotoSerializer(GroupPhotoSerializer):
    """A photo of ``GET /api/duplicates/{duplicate_id}/``."""

    file_type = serializers.CharField(
        allow_null=True, help_text="The main file's type as displayed: Image, ..."
    )
    is_kept = serializers.BooleanField(
        allow_null=True, help_text="null while the group has no kept photo"
    )


class DuplicateDetailSerializer(serializers.Serializer[None]):
    """``GET /api/duplicates/{duplicate_id}/``: a group with all its photos."""

    id = serializers.UUIDField()
    duplicate_type = serializers.ChoiceField(choices=Duplicate.DuplicateType.choices)
    duplicate_type_display = serializers.CharField()
    review_status = serializers.ChoiceField(choices=Duplicate.ReviewStatus.choices)
    review_status_display = serializers.CharField()
    photo_count = serializers.IntegerField()
    potential_savings = serializers.IntegerField(
        help_text="Bytes freed by trashing all but the kept photo"
    )
    similarity_score = serializers.FloatField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    kept_photo_hash = serializers.CharField(allow_null=True)
    suggested_photo_hash = serializers.CharField(
        allow_null=True, help_text="The photo the server would keep"
    )
    photos = DuplicatePhotoSerializer(many=True)


class DuplicateCountsByTypeSerializer(serializers.Serializer[None]):
    exact_copy = serializers.IntegerField()
    visual_duplicate = serializers.IntegerField()


class DuplicateStatsSerializer(serializers.Serializer[None]):
    """``GET /api/duplicates/stats/``; the savings are those of the pending groups."""

    total_duplicates = serializers.IntegerField()
    pending_duplicates = serializers.IntegerField()
    resolved_duplicates = serializers.IntegerField()
    dismissed_duplicates = serializers.IntegerField()
    by_type = DuplicateCountsByTypeSerializer()
    photos_in_duplicates = serializers.IntegerField()
    total_photos = serializers.IntegerField(
        help_text="The requester's photos that are not hidden or trashed"
    )
    potential_savings_bytes = serializers.IntegerField()
    potential_savings_mb = serializers.FloatField(help_text="Rounded to 2 decimals")


class ResolveDuplicateResponseSerializer(serializers.Serializer[None]):
    status = serializers.CharField(help_text='Always "resolved"')
    kept_photo = serializers.CharField(help_text="image_hash of the kept photo")
    trashed_count = serializers.IntegerField()


class DismissDuplicateResponseSerializer(serializers.Serializer[None]):
    status = serializers.CharField(help_text='Always "dismissed"')


class RevertDuplicateResponseSerializer(serializers.Serializer[None]):
    status = serializers.CharField(help_text='Always "reverted"')
    restored_count = serializers.IntegerField(
        help_text="Photos taken back out of the trash"
    )


class DetectDuplicatesQueuedSerializer(serializers.Serializer[None]):
    """``POST /api/duplicates/detect/`` (202): the detection job was queued."""

    status = serializers.CharField(help_text='Always "queued"')
    message = serializers.CharField()
    options = DetectDuplicatesRequest(help_text="The request, defaults filled in")
    job_id = serializers.CharField()
