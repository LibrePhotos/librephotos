"""Endpoints that start background jobs (through ``api.jobs.start``)."""

import os

from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import ValidationError
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.albums.auto_albums import delete_missing_photos
from api.directory_watcher import scan_photos
from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.jobs.start import start_job
from api.models import LongRunningJob
from api.models.user import User
from api.photos.retention import empty_trash_job
from api.runtime.ml_models import missing_models_prerequisites
from api.serializers.job import GenerateOcrRequest, JobStartedResponseSerializer
from api.thumbnails.metadata import strip_thumbnail_metadata_job


def _validate_scan_directory(user: User) -> None:
    """A 400 unless the user's scan directory is set and exists."""
    if not user.scan_directory or user.scan_directory.strip() == "":
        raise ValidationError(
            "Scan failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account."
        )

    if not os.path.exists(user.scan_directory):
        raise ValidationError(
            f"Scan failed: Scan directory '{user.scan_directory}' does not exist. Please contact your administrator."
        )


def _start_photo_scan(user: User, directory: str, full_scan: bool = False) -> Response:
    return start_job(
        user,
        LongRunningJob.JOB_SCAN_PHOTOS,
        scan_photos,
        user,
        full_scan,
        scan_directory=directory,
        description="the photo scan",
        prerequisites=missing_models_prerequisites(user),
    )


class ScanPhotosView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
        responses=JobStartedResponseSerializer,
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    def _scan_photos(self, request: Request) -> Response:
        user = request_user(request)
        _validate_scan_directory(user)
        return _start_photo_scan(user, user.scan_directory)


class FullScanPhotosView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
        responses=JobStartedResponseSerializer,
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    def _scan_photos(self, request: Request) -> Response:
        user = request_user(request)
        _validate_scan_directory(user)
        return _start_photo_scan(user, user.scan_directory, full_scan=True)


class DeleteMissingPhotosView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        return self._delete_missing_photos(request, format)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
        responses=JobStartedResponseSerializer,
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._delete_missing_photos(request, format)

    def _delete_missing_photos(
        self, request: Request, format: str | None = None
    ) -> Response:
        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_DELETE_MISSING_PHOTOS,
            delete_missing_photos,
            user,
            description="the missing-photo cleanup",
        )


class ClassifyMediaView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        from api.directory_watcher.processing_jobs import classify_media

        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_CLASSIFY_MEDIA,
            classify_media,
            user,
            description="media classification",
        )


class GenerateOcrView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=GenerateOcrRequest, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        from api.directory_watcher.processing_jobs import generate_ocr

        user = request_user(request)
        full_scan = parse_body(request, GenerateOcrRequest)["full_scan"]
        return start_job(
            user,
            LongRunningJob.JOB_GENERATE_OCR,
            generate_ocr,
            user,
            full_scan=full_scan,
            description="text recognition",
        )


class StripThumbnailMetadataView(APIView):
    """Start removing photo details from old thumbnails (#2321).

    The thumbnails of every user are walked, so only an admin may start it.
    """

    permission_classes = (IsAdminUser,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA,
            strip_thumbnail_metadata_job,
            user,
            description="the thumbnail metadata cleanup",
        )


class EmptyTrashView(APIView):
    """Permanently delete every photo in the requester's trash, as a job (#2203).

    Delete permanently on a select-all deletes in the request and runs into
    the gateway timeout on a large trash. This answers at once with the job;
    the job deletes the photos and their files. Only the requester's own
    photos; a second start while one runs is a 409.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_EMPTY_TRASH,
            empty_trash_job,
            user,
            description="emptying the trash",
        )
