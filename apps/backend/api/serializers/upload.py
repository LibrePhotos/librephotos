"""The answers and requests of the upload views (``api/views/upload.py``)."""

from rest_framework import serializers


class UploadExistsSerializer(serializers.Serializer[None]):
    """``GET /api/exists/{id}/``: whether the caller already has the file."""

    exists = serializers.BooleanField(
        help_text="The caller has a photo with this image_hash"
    )
    photo_id = serializers.UUIDField(
        allow_null=True,
        help_text="The id of the caller's photo with this image_hash, or null",
    )


class UploadCompleteRequest(serializers.Serializer[None]):
    """The LibrePhotos fields of ``POST /api/upload/complete/`` (multipart).

    ``upload_id``, ``md5`` and ``filename`` belong to the vendored
    chunked-upload protocol and are read by it.
    """

    album_id = serializers.IntegerField(
        required=False,
        allow_null=True,
        min_value=1,
        help_text="One of the uploader's own albums to add the photo to (#612)",
    )


class UploadSealRequest(serializers.Serializer[None]):
    """``POST /api/upload/seal/``: the import jobs an upload run is done with (#2737)."""

    job_ids = serializers.ListField(
        child=serializers.CharField(max_length=36),
        max_length=100,
        help_text="The job_id values POST /api/upload/complete/ answered in the run",
    )


class UploadSealResponse(serializers.Serializer[None]):
    """``POST /api/upload/seal/``: what the call sealed."""

    sealed_job_ids = serializers.ListField(
        child=serializers.CharField(),
        help_text="The jobs this call sealed. A job that was sealed already, has "
        "finished or is not the caller's is left out",
    )
