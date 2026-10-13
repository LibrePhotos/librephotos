"""Request input and answers of the stack views (``api/views/stacks.py``).

The answers are only for the OpenAPI schema: the views build the dicts.
"""

from rest_framework import serializers

from api.drf.params import JsonStringField, required_string
from api.models.photo_stack import PhotoStack
from api.serializers.photo_groups import (
    GroupPhotoSerializer,
    LegacyFlagsPageSerializer,
    PhotoGroupThumbnailSerializer,
)

# The types the stack list returns (``PhotoStack.VALID_STACK_TYPES``); a detail
# can also be a deprecated RAW+JPEG or Live Photo stack. The enum components
# are named in ENUM_NAME_OVERRIDES (two choice sets share the field name).
STACK_TYPES = PhotoStack.StackType.choices
LISTED_STACK_TYPES = [
    (stack_type.value, stack_type.label) for stack_type in PhotoStack.VALID_STACK_TYPES
]


class PhotoStackListQuery(serializers.Serializer[None]):
    """The filter; ``page``/``page_size`` are the paginator's (api/drf/pagination.py)."""

    stack_type = serializers.CharField(
        required=False,
        allow_blank=True,
        help_text="Filter by stack type: burst, bracket, manual (others are ignored)",
    )


class PhotoStackSetPrimaryRequest(serializers.Serializer[None]):
    photo_hash = required_string(
        "photo_hash is required",
        help_text="image_hash of the new cover photo; it must be in the stack",
    )


class DetectStacksRequest(serializers.Serializer[None]):
    detect_bursts = serializers.BooleanField(
        default=True,
        help_text="Detect burst sequences using the user's configured rules",
    )


class CreateManualStackRequest(serializers.Serializer[None]):
    photo_hashes = serializers.ListField(
        child=JsonStringField(),
        default=list,
        help_text="At least 2 of the requester's photos",
    )


class StackPhotosRequest(serializers.Serializer[None]):
    """The photos to add to, remove from or merge stacks by."""

    photo_hashes = serializers.ListField(
        child=JsonStringField(),
        allow_empty=False,
        error_messages={
            "required": "photo_hashes is required",
            "null": "photo_hashes is required",
            "empty": "photo_hashes is required",
        },
    )


class PhotoStackListItemSerializer(serializers.Serializer[None]):
    """A row of ``GET /api/stacks/``."""

    id = serializers.UUIDField()
    stack_type = serializers.ChoiceField(choices=LISTED_STACK_TYPES)
    stack_type_display = serializers.CharField()
    photo_count = serializers.IntegerField()
    sequence_start = serializers.DateTimeField(allow_null=True)
    sequence_end = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    primary_photo = PhotoGroupThumbnailSerializer(allow_null=True)
    preview_photos = PhotoGroupThumbnailSerializer(
        many=True, help_text="The first four photos"
    )


class PhotoStackPageSerializer(LegacyFlagsPageSerializer):
    """A page of ``GET /api/stacks/``: stacks with at least 2 photos, newest first."""

    results = PhotoStackListItemSerializer(many=True)


class StackFileVariantSerializer(serializers.Serializer[None]):
    """One file of a stack photo (RAW, JPEG, ...)."""

    hash = serializers.CharField()
    path = serializers.CharField()
    type = serializers.CharField(
        help_text="The file type in lower case: image, video, raw file, ..."
    )
    is_main = serializers.BooleanField(
        allow_null=True, help_text="null when the photo has no main file"
    )
    filename = serializers.CharField(allow_null=True)


class StackPhotoSerializer(GroupPhotoSerializer):
    """A photo of ``GET /api/stacks/{stack_id}/``."""

    file_type = serializers.CharField(
        allow_null=True, help_text="The main file's type in lower case: image, ..."
    )
    is_primary = serializers.BooleanField(
        allow_null=True, help_text="null when the stack has no cover photo"
    )
    file_variants = StackFileVariantSerializer(
        many=True, allow_null=True, help_text="null when the photo has no files"
    )


class PhotoStackSerializer(serializers.Serializer[None]):
    """``GET /api/stacks/{stack_id}/``: a stack with all its photos."""

    id = serializers.UUIDField()
    stack_type = serializers.ChoiceField(choices=STACK_TYPES)
    stack_type_display = serializers.CharField()
    photo_count = serializers.IntegerField()
    sequence_start = serializers.DateTimeField(allow_null=True)
    sequence_end = serializers.DateTimeField(allow_null=True)
    created_at = serializers.DateTimeField()
    updated_at = serializers.DateTimeField()
    primary_photo_hash = serializers.CharField(allow_null=True)
    photos = StackPhotoSerializer(many=True)


class StackCountsByTypeSerializer(serializers.Serializer[None]):
    """Stacks per type. The listed types count what the list shows; the
    deprecated ones count every stack of theirs."""

    burst = serializers.IntegerField()
    bracket = serializers.IntegerField()
    manual = serializers.IntegerField()
    raw_jpeg = serializers.IntegerField()
    live_photo = serializers.IntegerField()


class PhotoStackStatsSerializer(serializers.Serializer[None]):
    """``GET /api/stacks/stats/``."""

    total_stacks = serializers.IntegerField(help_text="The stacks the list shows")
    by_type = StackCountsByTypeSerializer()
    photos_in_stacks = serializers.IntegerField()
    total_photos = serializers.IntegerField(
        help_text="The requester's photos that are not hidden or trashed"
    )


class SetStackPrimaryResponseSerializer(serializers.Serializer[None]):
    status = serializers.CharField(help_text='Always "updated"')
    primary_photo_hash = serializers.CharField()


class DetectStacksQueuedSerializer(serializers.Serializer[None]):
    """``POST /api/stacks/detect/`` (202): the detection job was queued."""

    status = serializers.CharField(help_text='Always "queued"')
    message = serializers.CharField()
    options = DetectStacksRequest(help_text="The request, defaults filled in")
    job_id = serializers.CharField()


class CreateManualStackResponseSerializer(serializers.Serializer[None]):
    """``POST /api/stacks/manual/`` (201): the manual stack the photos are in
    now, an existing one of theirs or a new one."""

    status = serializers.CharField(help_text='Always "created"')
    stack_id = serializers.UUIDField()
    photo_count = serializers.IntegerField(help_text="The photos given, each once")


class AddToStackResponseSerializer(serializers.Serializer[None]):
    status = serializers.CharField(help_text='Always "updated"')
    added_count = serializers.IntegerField()
    total_count = serializers.IntegerField()


class RemoveFromStackResponseSerializer(serializers.Serializer[None]):
    """``updated``, or ``deleted`` (with a message) when fewer than 2 photos were left."""

    status = serializers.CharField(help_text='"updated" or "deleted"')
    removed_count = serializers.IntegerField()
    total_count = serializers.IntegerField(required=False, help_text="updated only")
    message = serializers.CharField(required=False, help_text="deleted only")


class MergeStacksResponseSerializer(serializers.Serializer[None]):
    """``merged``, or ``no_merge_needed`` (with a message) when the photos are
    in one manual stack only."""

    status = serializers.CharField(help_text='"merged" or "no_merge_needed"')
    stack_id = serializers.UUIDField(help_text="The stack the others went into")
    photo_count = serializers.IntegerField()
    merged_count = serializers.IntegerField(required=False, help_text="merged only")
    message = serializers.CharField(required=False, help_text="no_merge_needed only")
