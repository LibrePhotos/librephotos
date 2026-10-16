"""Endpoints that start background jobs (through ``api.jobs.start``)."""

import os

from drf_spectacular.utils import extend_schema
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import IsAdminUser, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.albums.auto_albums import delete_missing_photos
from api.classification.captioning import captioning_available
from api.directory_watcher import scan_photos
from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.jobs.start import start_job
from api.metadata.date_rules_job import reapply_date_rules_job
from api.models import LongRunningJob
from api.models.user import User
from api.photos.library_files import rescan_targets, scannable_files
from api.photos.retention import empty_trash_job
from api.runtime.features import feature_enabled
from api.runtime.ml_models import (
    captioning_model_prerequisites,
    missing_models_prerequisites,
)
from api.serializers.job import (
    CaptionsJobStartedResponseSerializer,
    GenerateCaptionsRequest,
    GenerateOcrRequest,
    JobStartedResponseSerializer,
    RescanPhotosRequest,
    RescanPhotosResponseSerializer,
    ScanFilesRequest,
    ScanFilesResponseSerializer,
)
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


def _start_file_scan(
    user: User, paths: list[str], force_files: bool, description: str
) -> Response:
    """Scan ``paths``, a list of the user's files, as a Scan Photos job.

    Not a library scan, so it never becomes the change baseline of the next
    one (#2192); its follow-ups only cover what is new.
    """
    return start_job(
        user,
        LongRunningJob.JOB_SCAN_PHOTOS,
        scan_photos,
        user,
        False,
        scan_files=paths,
        force_files=force_files,
        description=description,
        prerequisites=missing_models_prerequisites(user),
    )


class RescanPhotosView(APIView):
    """Read the files of some of the requester's photos again (#2214).

    Also the files that did not change: their thumbnails, metadata, date and
    hashes are read and rendered again. Dates set by hand, locations, captions
    and albums stay (exif-data.md, How a rescan treats your edits). Faces are
    not detected again; that is ``POST /api/scanfaces`` with ``photo_ids``.
    404 when none of the photos is the requester's, 400 when none has a file
    left in their library, 409 while a scan runs.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=RescanPhotosRequest, responses=RescanPhotosResponseSerializer
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        photo_ids = parse_body(request, RescanPhotosRequest)["photo_ids"]
        targets = rescan_targets(user, photo_ids)
        if not targets.found:
            raise NotFound("None of these photos is yours.")
        if not targets.paths:
            raise ValidationError(
                "None of these photos has a file in your library any more.",
                code="no_files_to_scan",
            )
        response = _start_file_scan(
            user, targets.paths, True, "the rescan of the selected photos"
        )
        response.data["photo_count"] = targets.photo_count
        response.data["file_count"] = len(targets.paths)
        return response


class ScanFilesView(APIView):
    """Scan files an outside process says are new or changed (#900).

    For a folder watcher (inotify, watchfiles) next to the library: it sends
    the paths, as the server sees them, with the user's credentials. Only
    existing files inside the requester's scan directory or upload folder are
    scanned; the answer lists the paths it left out. A file is read when it is
    new or changed, as on an incremental scan. 400 when no path is left, 409
    while a scan of the requester's runs (send the paths again later).
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=ScanFilesRequest, responses=ScanFilesResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        paths = parse_body(request, ScanFilesRequest)["paths"]
        kept, ignored = scannable_files(user, paths)
        if not kept:
            raise ValidationError(
                "None of the paths is a file in your library.",
                code="no_files_to_scan",
            )
        response = _start_file_scan(user, kept, False, "the scan of the given files")
        response.data["file_count"] = len(kept)
        response.data["ignored_paths"] = ignored
        return response


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


class GenerateCaptionsView(APIView):
    """Caption the requester's photos, as a job (#2211).

    Refused (403) while captioning is off: the feature switch, or the
    captioning model set to "None". When the model is not on disk yet its
    download is chained in front and the answer says so (``downloads_model``).
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(
        request=GenerateCaptionsRequest,
        responses=CaptionsJobStartedResponseSerializer,
    )
    def post(self, request: Request, format: str | None = None) -> Response:
        from api.directory_watcher.processing_jobs import generate_captions

        if not captioning_available():
            raise PermissionDenied("Image captioning is disabled")
        user = request_user(request)
        full_scan = parse_body(request, GenerateCaptionsRequest)["full_scan"]
        prerequisites = captioning_model_prerequisites(user)
        response = start_job(
            user,
            LongRunningJob.JOB_GENERATE_CAPTIONS,
            generate_captions,
            user,
            full_scan=full_scan,
            description="caption generation",
            prerequisites=prerequisites,
        )
        response.data["downloads_model"] = bool(prerequisites)
        return response


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


class ReapplyDateRulesView(APIView):
    """Read the date of the requester's photos again with their current date
    rules (#437).

    Only the requester's own photos; a date set by hand stays and nothing is
    written to the files. A second start while one runs is a 409.
    """

    permission_classes = (IsAuthenticated,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_REAPPLY_DATE_RULES,
            reapply_date_rules_job,
            user,
            description="applying the date rules",
        )


class LookUpPlacesView(APIView):
    """Look the place names of every photo up again with the current Map
    Provider (#2302).

    Switching the provider renames nothing by itself; this asks it again for
    every user's photos, so only an admin may start it. A 400 while reverse
    geocoding is turned off, a 409 while one runs.
    """

    permission_classes = (IsAdminUser,)

    @extend_schema(request=None, responses=JobStartedResponseSerializer)
    def post(self, request: Request, format: str | None = None) -> Response:
        from api.directory_watcher.processing_jobs import look_up_places

        if not feature_enabled("REVERSE_GEOCODING"):
            raise ValidationError(
                "Reverse geocoding is turned off (FEATURE_REVERSE_GEOCODING).",
                code="reverse_geocoding_disabled",
            )
        user = request_user(request)
        return start_job(
            user,
            LongRunningJob.JOB_LOOK_UP_PLACES,
            look_up_places,
            user,
            description="looking up place names",
        )
