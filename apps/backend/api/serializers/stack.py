"""Request input of the stack views (``api/views/stacks.py``)."""

from rest_framework import serializers

from api.views.params import JsonStringField, required_string


class PhotoStackListQuery(serializers.Serializer[None]):
    """The filter; ``page``/``page_size`` are the paginator's (api/pagination.py)."""

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
