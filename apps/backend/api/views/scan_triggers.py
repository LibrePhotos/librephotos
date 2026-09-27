"""Endpoints that start background jobs, and the ``start_job`` helper they share."""

import os
import uuid

from django_q.tasks import AsyncTask, Chain
from drf_spectacular.utils import extend_schema
from rest_framework.response import Response
from rest_framework.views import APIView

from api.autoalbum import delete_missing_photos
from api.directory_watcher import scan_photos
from api.ml_models import do_all_models_exist, download_models
from api.util import logger


def _validate_scan_directory(user):
    if not user.scan_directory or user.scan_directory.strip() == "":
        return Response(
            {
                "status": False,
                "message": "Scan failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account.",
            },
            status=400,
        )

    if not os.path.exists(user.scan_directory):
        return Response(
            {
                "status": False,
                "message": f"Scan failed: Scan directory '{user.scan_directory}' does not exist. Please contact your administrator.",
            },
            status=400,
        )

    return None


def start_job(enqueue, description):
    """Queue a background job for a request and answer that request.

    ``enqueue(job_id)`` hands the work to django-q2. When that fails (the
    broker is unreachable, say) the job never started, and the client is told
    so with a 500 rather than a 200 carrying ``"status": False``.
    """
    job_id = uuid.uuid4()
    try:
        enqueue(job_id)
    except Exception:
        logger.exception(f"Could not start {description}")
        return Response(
            {"status": False, "message": f"Could not start {description}."},
            status=500,
        )
    return Response({"status": True, "job_id": job_id})


def _start_photo_scan(user, directory, full_scan=False):
    def enqueue(job_id):
        chain = Chain()
        if not do_all_models_exist():
            chain.append(download_models, user)
        chain.append(scan_photos, user, full_scan, job_id, directory)
        chain.run()

    return start_job(enqueue, "the photo scan")


class ScanPhotosView(APIView):
    def post(self, request, format=None):
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request, format=None):
        return self._scan_photos(request)

    def _scan_photos(self, request):
        return _validate_scan_directory(request.user) or _start_photo_scan(
            request.user, request.user.scan_directory
        )


# To-Do: Allow for custom paths
class SelectiveScanPhotosView(APIView):
    def get(self, request, format=None):
        # To-Do: Sanatize the scan_directory
        return _validate_scan_directory(request.user) or _start_photo_scan(
            request.user,
            os.path.join(request.user.scan_directory, "uploads", "web"),
        )


class FullScanPhotosView(APIView):
    def post(self, request, format=None):
        return self._scan_photos(request)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request, format=None):
        return self._scan_photos(request)

    def _scan_photos(self, request):
        return _validate_scan_directory(request.user) or _start_photo_scan(
            request.user, request.user.scan_directory, full_scan=True
        )


class DeleteMissingPhotosView(APIView):
    def post(self, request, format=None):
        return self._delete_missing_photos(request, format)

    @extend_schema(
        deprecated=True,
        description="Use POST method instead",
    )
    def get(self, request, format=None):
        return self._delete_missing_photos(request, format)

    def _delete_missing_photos(self, request, format=None):
        return start_job(
            lambda job_id: AsyncTask(delete_missing_photos, request.user, job_id).run(),
            "the missing-photo cleanup",
        )


class ClassifyMediaView(APIView):
    def post(self, request, format=None):
        from api.directory_watcher.processing_jobs import classify_media

        return start_job(
            lambda job_id: AsyncTask(classify_media, request.user, job_id).run(),
            "media classification",
        )


class GenerateOcrView(APIView):
    def post(self, request, format=None):
        from api.directory_watcher.processing_jobs import generate_ocr

        full_scan = bool(request.data.get("full_scan", False))
        return start_job(
            lambda job_id: AsyncTask(
                generate_ocr, request.user, job_id, full_scan
            ).run(),
            "text recognition",
        )
