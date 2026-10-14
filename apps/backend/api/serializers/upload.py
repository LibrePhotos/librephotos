"""The answers of the upload views (``api/views/upload.py``)."""

from rest_framework import serializers


class UploadExistsSerializer(serializers.Serializer[None]):
    """``GET /api/exists/{id}/``: whether the caller already has the file."""

    exists = serializers.BooleanField(
        help_text="The caller has a photo with this image_hash"
    )
