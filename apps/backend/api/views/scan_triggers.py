"""Endpoints that start background jobs, and the ``start_job`` helper they share."""

import logging
import os
import uuid
from collections.abc import Callable

from django_q.tasks import AsyncTask, Chain
from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import APIException, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.autoalbum import delete_missing_photos
from api.directory_watcher import scan_photos
from api.ml_models import do_all_models_exist, download_models
from api.models.user import User
from api.request_user import request_user
from api.serializers.job import GenerateOcrRequest
from api.views.params import parse_body

logger = logging.getLogger(__name__)


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


def start_job(enqueue: Callable[[uuid.UUID], object], description: str) -> Response:
    """Queue a background job for a request and answer that request.

    ``enqueue(job_id)`` hands the work to django-q2. When that fails (the
    broker is unreachable, say) the job never started, and the client is told
    so with a 500 (code ``job_start_failed``) rather than a 200 carrying
    ``"status": False``.
    """
    job_id = uuid.uuid4()
    try:
        enqueue(job_id)
    except Exception as error:
        logger.exception("Could not start %s", description)
        raise APIException(
            f"Could not start {description}.", code="job_start_failed"
        ) from error
    return Response({"status": True, "job_id": job_id})


def _start_photo_scan(user: User, directory: str, full_scan: bool = False) -> Response:
    def enqueue(job_id: uuid.UUID) -> None:
        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, user)
        chain.append(scan_photos, user, full_scan, job_id, directory)
        chain.run()

    return start_job(enqueue, "the photo scan")


class ScanPhotosView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    def _scan_photos(self, request: Request) -> Response:
        user = request_user(request)
        _validate_scan_directory(user)
        return _start_photo_scan(user, user.scan_directory)


class FullScanPhotosView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._scan_photos(request)

    def _scan_photos(self, request: Request) -> Response:
        user = request_user(request)
        _validate_scan_directory(user)
        return _start_photo_scan(user, user.scan_directory, full_scan=True)


class DeleteMissingPhotosView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request: Request, format: str | None = None) -> Response:
        return self._delete_missing_photos(request, format)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request: Request, format: str | None = None) -> Response:
        return self._delete_missing_photos(request, format)

    def _delete_missing_photos(
        self, request: Request, format: str | None = None
    ) -> Response:
        user = request_user(request)
        return start_job(
            lambda job_id: AsyncTask(delete_missing_photos, user, job_id).run(),
            "the missing-photo cleanup",
        )


class ClassifyMediaView(APIView):
    permission_classes = (IsAuthenticated,)

    def post(self, request: Request, format: str | None = None) -> Response:
        from api.directory_watcher.processing_jobs import classify_media

        user = request_user(request)
        return start_job(
            lambda job_id: AsyncTask(classify_media, user, job_id).run(),
            "media classification",
        )


class GenerateOcrView(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=GenerateOcrRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        from api.directory_watcher.processing_jobs import generate_ocr

        user = request_user(request)
        full_scan = parse_body(request, GenerateOcrRequest)["full_scan"]
        return start_job(
            lambda job_id: AsyncTask(generate_ocr, user, job_id, full_scan).run(),
            "text recognition",
        )
