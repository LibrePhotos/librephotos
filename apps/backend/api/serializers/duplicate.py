"""Request input of the duplicate views (``api/views/duplicates.py``)."""

from rest_framework import serializers

from api.drf.params import ClampedIntegerField


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
