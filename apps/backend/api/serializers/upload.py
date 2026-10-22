"""The answers and requests of the upload views (``api/views/upload.py``)."""

from rest_framework import serializers

from api.jobs.upload_followups import FollowupStatus
from api.jobs.upload_status import UploadStatus
from api.serializers.job import LongRunningJobSerializer


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


# A client names at most this many jobs and photos in one status read.
MAX_STATUS_IDS = 100
FOLLOWUP_STATES = ["idle", "pending", "running"]


class UploadStatusQuery(serializers.Serializer[None]):
    """``GET /api/upload/status/``: the jobs and photos an upload client follows (#2739)."""

    job_id = serializers.ListField(
        child=serializers.CharField(max_length=36),
        required=False,
        default=list,
        max_length=MAX_STATUS_IDS,
        help_text="Repeatable. Import jobs POST /api/upload/complete/ answered, "
        "listed even once they finished; someone else's id is ignored",
    )
    photo_id = serializers.ListField(
        child=serializers.UUIDField(),
        required=False,
        default=list,
        max_length=MAX_STATUS_IDS,
        help_text="Repeatable. Uploaded photos to check for being ready; "
        "someone else's id is ignored",
    )


class UploadFollowupsSerializer(serializers.Serializer[FollowupStatus]):
    """The library-level work after uploads (search embeddings, faces, text)."""

    state = serializers.ChoiceField(
        choices=FOLLOWUP_STATES,
        help_text="running: a follow-up run is working; pending: one starts "
        "within a few minutes; idle: neither",
    )
    next_run_at = serializers.DateTimeField(
        allow_null=True,
        help_text="When the next follow-up run is scheduled; a run waiting for a "
        "quiet period (face clustering) can be hours ahead",
    )


class UploadStatusSerializer(serializers.Serializer[UploadStatus]):
    """``GET /api/upload/status/``: the caller's upload imports and follow-ups."""

    imports = LongRunningJobSerializer(
        many=True,
        help_text="The caller's unfinished Import Uploads jobs (from any client) "
        "and the named ones, newest first",
    )
    ready_photo_ids = serializers.ListField(
        child=serializers.UUIDField(),
        help_text="The named photos that have their thumbnails and show in the timeline",
    )
    followups = UploadFollowupsSerializer()
