import datetime
import logging
import os
import re
import shutil
from collections.abc import Mapping
from typing import cast
from zoneinfo import ZoneInfo, ZoneInfoNotFoundError

from constance import config as site_config
from django.core.files.base import ContentFile
from django.core.files.uploadedfile import UploadedFile
from django.db.models import QuerySet
from django.db.models.fields.files import FieldFile
from django.http import HttpRequest, HttpResponse
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.utils.text import get_valid_filename
from django.views.decorators.csrf import csrf_exempt
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework import viewsets
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import AuthenticationFailed, InvalidToken

from api.accounts.authentication import JWTCookieAuthentication
from api.directory_watcher import create_new_image, handle_new_image, is_valid_media
from api.directory_watcher.file_handlers import apply_device_timestamp_fallback
from api.drf.request_user import request_user
from api.faces.photo_faces import extract_faces
from api.geocode.photo_location import add_location_to_album_dates, geolocate_photo
from api.jobs.queue import Task, enqueue_task_chain
from api.models import Photo
from api.models.photo_caption import PhotoCaption
from api.models.user import User
from api.photos.media_files import calculate_hash
from api.search import semantic
from api.serializers.upload import UploadExistsSerializer
from chunked_upload.constants import http_status
from chunked_upload.exceptions import ChunkedUploadError
from chunked_upload.models import ChunkedUpload
from chunked_upload.views import ChunkedUploadCompleteView, ChunkedUploadView

logger = logging.getLogger(__name__)


# Epoch milliseconds have at least 11 digits from 1970-04-26 on; a shorter
# number is a compact date ("20251011") or garbage, not a 1970 timestamp.
_EPOCH_MS = re.compile(r"-?\d{11,}")
_EPOCH = datetime.datetime(1970, 1, 1, tzinfo=datetime.timezone.utc)
# UTC offsets in use run from -12:00 to +14:00.
_MAX_UTC_OFFSET_MINUTES = 14 * 60


def parse_utc_offset(raw: str | None) -> datetime.timedelta | None:
    """A client's UTC offset in minutes east of UTC (``-420`` for UTC-7, the
    sign of ISO 8601, not of JavaScript's ``getTimezoneOffset()``), or None
    when absent or out of range."""
    if raw is None or not re.fullmatch(r"[+-]?\d{1,4}", raw.strip()):
        return None
    minutes = int(raw)
    if abs(minutes) > _MAX_UTC_OFFSET_MINUTES:
        return None
    return datetime.timedelta(minutes=minutes)


def parse_device_timestamp(
    raw: str | int | None,
    utc_offset: datetime.timedelta | None = None,
    default_timezone: str = "UTC",
) -> datetime.datetime | None:
    """The local time a client says a photo was taken (doc 04 §5), or None
    when absent or unparseable.

    Returned as the local wall clock labelled UTC, as ``Photo.timestamp`` and
    ``exif_timestamp`` hold every capture time:

    - ISO 8601 with an offset or ``Z``: the wall clock in that offset;
    - ISO 8601 without one: the wall clock as given;
    - epoch milliseconds (an integer of 11 digits or more): an instant with no
      zone, shown at ``utc_offset`` when the client sent it, else in the
      owner's ``default_timezone``.
    """
    if raw is None:
        return None
    text = str(raw).strip()
    if _EPOCH_MS.fullmatch(text):
        try:
            instant = _EPOCH + datetime.timedelta(milliseconds=int(text))
        except OverflowError:
            return None
        if utc_offset is not None:
            local = instant + utc_offset
        else:
            local = instant.astimezone(_zone(default_timezone))
        return local.replace(tzinfo=datetime.timezone.utc)
    if text.lstrip("+-").isdigit():
        # Too short for epoch milliseconds. Python 3.11 would read eight
        # digits as an ISO basic date, 3.10 (the GPU image) would not.
        return None
    try:
        parsed = datetime.datetime.fromisoformat(text.replace("Z", "+00:00"))
    except ValueError:
        return None
    return parsed.replace(tzinfo=datetime.timezone.utc)


def _zone(name: str) -> datetime.tzinfo:
    try:
        return ZoneInfo(name or "UTC")
    except (ZoneInfoNotFoundError, ValueError):
        return datetime.timezone.utc


def generate_captions_wrapper(photo: Photo, commit: bool = True) -> None:
    """Wrapper function to generate captions for use in chain"""
    caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
    semantic.generate_photo_tags(caption_instance, commit=commit)


def _forbidden(detail: str) -> ChunkedUploadError:
    return ChunkedUploadError(
        status=http_status.HTTP_403_FORBIDDEN,
        detail=detail,
    )


def _bad_request(detail: str) -> ChunkedUploadError:
    return ChunkedUploadError(
        status=http_status.HTTP_400_BAD_REQUEST,
        detail=detail,
    )


def authenticate_upload_request(request: HttpRequest) -> User:
    """Resolve the uploading user for the chunked-upload views.

    These views predate the mobile client and read the JWT from a ``jwt``
    cookie, which is a browser-ism: React Native's ``fetch`` cannot reliably set
    a ``Cookie`` header (on iOS ``NSURLSession`` owns the cookie store and drops
    it), so a native client had to forge a cookie that never arrived and every
    ``/api/upload/complete/`` answered 403.

    The header is therefore checked first and the cookie kept as a fallback, so
    the web frontend is unaffected (``JWTCookieAuthentication``). These are
    plain Django views, not DRF ones, so the class is called directly and its
    failures are reported the way the chunked-upload client expects: as
    ``ChunkedUploadError`` (403).
    """
    try:
        credentials = JWTCookieAuthentication().authenticate_strict(request)
    except InvalidToken:
        raise _forbidden("Authentication credentials were invalid")
    except AuthenticationFailed:
        # A malformed header, or a token for an account that is gone or
        # deactivated.
        raise _forbidden("Authentication credentials were not provided")
    if credentials is None:
        raise _forbidden("Authentication credentials were not provided")
    user, _token = credentials
    if not isinstance(user, User):
        # simplejwt types the authenticated user loosely; the model backend
        # always returns a User, and anything else is refused like no login.
        raise _forbidden("Authentication credentials were not provided")
    return user


def _staged_path(uploaded_file: UploadedFile) -> str:
    """Filesystem path of a staged chunked upload.

    ``get_uploaded_file`` wraps the model's FileField, so ``.file`` is a
    FieldFile with a path at runtime; typeshed only knows it as a generic file
    object. Not asserted: the completion tests hand in a fake with the same
    ``.file.path`` shape, and an isinstance check would refuse it.
    """
    return cast(FieldFile, uploaded_file.file).path


def validate_scan_directory(user: User) -> None:
    if not user.scan_directory or user.scan_directory.strip() == "":
        raise _bad_request(
            "Upload failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account."
        )
    if not os.path.exists(user.scan_directory):
        raise _bad_request(
            f"Upload failed: Scan directory '{user.scan_directory}' does not exist. Please contact your administrator."
        )


class UploadPhotoExists(viewsets.ViewSet):
    permission_classes = (IsAuthenticated,)

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "id",
                OpenApiTypes.STR,
                OpenApiParameter.PATH,
                description=(
                    "The file's image_hash: its MD5 hex digest followed by "
                    "the user's id (calculate_hash)"
                ),
            )
        ],
        responses=UploadExistsSerializer,
    )
    def retrieve(self, request: Request, pk: str) -> Response:
        # Only the requester's own library counts: answering for other users'
        # hashes would tell anyone which files someone else has uploaded.
        exists = (
            Photo.objects.owned_by(request_user(request)).filter(image_hash=pk).exists()
        )
        return Response({"exists": exists})


class UploaderScopedMixin:
    """Tie a chunked upload to the user who authenticated the request.

    The vendored views record ``request.user`` on a new upload and resolve
    ``upload_id`` among ``request.user``'s uploads, but only when
    ``request.user`` is authenticated. These are plain Django views that
    authenticate the JWT themselves and never set it, so uploads were stored
    without a user and any authenticated caller holding an ``upload_id`` could
    append to or complete someone else's upload (completion imports the staged
    file as the caller).
    """

    model: type[ChunkedUpload]
    upload_user: User | None = None

    def check_permissions(self, request: HttpRequest) -> None:
        if not site_config.ALLOW_UPLOAD:
            raise _forbidden("Uploading is not allowed")
        self.upload_user = authenticate_upload_request(request)

    def get_queryset(self, request: HttpRequest) -> QuerySet[ChunkedUpload]:
        if self.upload_user is None:
            return self.model.objects.none()
        return self.model.objects.filter(user=self.upload_user)


@method_decorator(csrf_exempt, name="dispatch")
class UploadPhotosChunked(UploaderScopedMixin, ChunkedUploadView):
    model = ChunkedUpload

    # To-Do: Check if file is allowed type

    def get_extra_attrs(self, request: HttpRequest) -> Mapping[str, object]:
        return {"user": self.upload_user}

    def create_chunked_upload(
        self, save: bool = False, **attrs: object
    ) -> ChunkedUpload:
        """Creates new chunked upload instance. Called if no 'upload_id' is
        found in the POST data.
        """
        chunked_upload = self.model(**attrs)
        # file starts empty
        chunked_upload.file.save(name="tmp", content=ContentFile(""), save=save)
        return chunked_upload


@method_decorator(csrf_exempt, name="dispatch")
class UploadPhotosChunkedComplete(UploaderScopedMixin, ChunkedUploadCompleteView):
    model = ChunkedUpload

    def delete_chunked_upload(
        self, request: HttpRequest, uploaded_file: UploadedFile
    ) -> None:
        chunked_upload = get_object_or_404(
            self.get_queryset(request), upload_id=request.POST.get("upload_id")
        )
        # Release our handle on the staged file before removing it; a
        # still-open handle makes the delete fail outright on Windows and
        # leaks a descriptor everywhere else.
        uploaded_file.close()
        chunked_upload.delete(delete_file=True)

    def target_path(
        self, user: User, device: str, filename: str, image_hash: str
    ) -> str:
        """Destination for the upload, or "" when it is a known duplicate."""
        if Photo.objects.filter(image_hash=image_hash).exists():
            logger.info("Photo %s duplicated with hash %s ", filename, image_hash)
            return ""

        upload_dir = os.path.join(user.upload_root(), device)
        photo_path = os.path.join(upload_dir, filename)
        if not os.path.exists(photo_path):
            return photo_path

        if calculate_hash(user, photo_path) == image_hash:
            # File already exist, do not copy it in the upload folder
            logger.info("Photo %s duplicated with hash %s ", filename, image_hash)
            return ""

        file_name, file_name_extension = os.path.splitext(os.path.basename(filename))
        return os.path.join(
            upload_dir, file_name + "_" + image_hash + file_name_extension
        )

    def import_photo(
        self,
        user: User,
        photo_path: str,
        image_hash: str,
        device_created_at: datetime.datetime | None = None,
    ) -> None:
        photo = create_new_image(user, photo_path)
        enqueue_task_chain(
            [
                Task(handle_new_image, (user, photo_path, image_hash, photo)),
                Task(
                    apply_device_timestamp_fallback,
                    (photo, device_created_at),
                ),
                Task(generate_captions_wrapper, (photo, True)),
                Task(geolocate_photo, (photo,)),
                Task(add_location_to_album_dates, (photo,)),
                Task(extract_faces, (photo,)),
            ]
        )

    def on_completion(
        self, uploaded_file: UploadedFile, request: HttpRequest
    ) -> HttpResponse | None:
        user = authenticate_upload_request(request)
        validate_scan_directory(user)

        if not is_valid_media(_staged_path(uploaded_file), user):
            self.delete_chunked_upload(request, uploaded_file)
            raise _bad_request("File type not allowed")

        # Sanitize file name. get_valid_filename applies str() itself, so
        # wrapping a missing value here changes nothing.
        filename = get_valid_filename(str(request.POST.get("filename")))

        # To-Do: Get origin device
        device = "web"

        os.makedirs(os.path.join(user.upload_root(), device), exist_ok=True)

        # Hashed and copied from the staged file on disk: read into memory,
        # a large video cost the web worker its whole size in RAM.
        staged_path = _staged_path(uploaded_file)
        image_hash = calculate_hash(user, staged_path)
        photo_path = self.target_path(user, device, filename, image_hash)

        if photo_path:
            shutil.copyfile(staged_path, photo_path)

        self.delete_chunked_upload(request, uploaded_file)

        if not photo_path:
            return Response(
                {"detail": "Photo duplicated. No new import performed."},
                status=http_status.HTTP_200_OK,
            )

        # Optional client-supplied capture time, used as a timestamp fallback
        # for photos that carry no EXIF date (doc 04 §5, issue #614); the
        # modification time stands in when the device has no creation time.
        utc_offset = parse_utc_offset(request.POST.get("device_tz_offset"))
        device_time = parse_device_timestamp(
            request.POST.get("device_created_at"), utc_offset, user.default_timezone
        ) or parse_device_timestamp(
            request.POST.get("device_modified_at"), utc_offset, user.default_timezone
        )
        self.import_photo(
            user,
            photo_path,
            image_hash,
            device_created_at=device_time,
        )
        return None
