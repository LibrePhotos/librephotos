import io
import os

from chunked_upload.constants import http_status
from chunked_upload.exceptions import ChunkedUploadError
from chunked_upload.models import ChunkedUpload
from chunked_upload.views import ChunkedUploadCompleteView, ChunkedUploadView
from constance import config as site_config
from django.core.files.base import ContentFile
from django.shortcuts import get_object_or_404
from django.utils.decorators import method_decorator
from django.utils.text import get_valid_filename
from django.views.decorators.csrf import csrf_exempt
from django_q.tasks import Chain
from rest_framework import viewsets
from rest_framework.response import Response
from rest_framework_simplejwt.exceptions import TokenError
from rest_framework_simplejwt.tokens import AccessToken

from api import util
from api.directory_watcher import create_new_image, handle_new_image, is_valid_media
from api.directory_watcher.file_handlers import apply_device_timestamp_fallback
from api.models import Photo, User
from api.models.file import calculate_hash, calculate_hash_b64
from api.models.photo_caption import PhotoCaption


def parse_device_timestamp(raw):
    """Parse a client-supplied timestamp (doc 04 §5).

    Accepts either epoch milliseconds (int/str) or an ISO-8601 string. Returns
    a timezone-aware UTC ``datetime`` or ``None`` when absent/unparseable.
    """
    if raw in (None, ""):
        return None
    import datetime as _dt

    from django.utils import timezone as _tz

    # epoch milliseconds
    try:
        ms = int(raw)
        return _dt.datetime.fromtimestamp(ms / 1000, tz=_dt.timezone.utc)
    except (TypeError, ValueError):
        pass
    try:
        parsed = _dt.datetime.fromisoformat(str(raw).replace("Z", "+00:00"))
    except (TypeError, ValueError):
        return None
    if parsed.tzinfo is None:
        parsed = _tz.make_aware(parsed, _dt.timezone.utc)
    return parsed


def _bearer_token(request):
    """Extract the raw JWT from an ``Authorization: Bearer <token>`` header."""
    header = request.META.get("HTTP_AUTHORIZATION") or ""
    prefix = "bearer "
    if header.lower().startswith(prefix):
        token = header[len(prefix) :].strip()
        return token or None
    return None


def authenticate_upload_request(request):
    """Resolve the uploading user for the chunked-upload views.

    These views predate the mobile client and read the JWT from a ``jwt``
    cookie, which is a browser-ism: React Native's ``fetch`` cannot reliably set
    a ``Cookie`` header (on iOS ``NSURLSession`` owns the cookie store and drops
    it), so a native client had to forge a cookie that never arrived and every
    ``/api/upload/complete/`` answered 403.

    The header is therefore checked first and the cookie kept as a fallback, so
    the web frontend is unaffected. Raises ``ChunkedUploadError`` (403) when no
    usable credential is present.
    """
    raw = _bearer_token(request) or request.COOKIES.get("jwt")
    if not raw:
        raise ChunkedUploadError(
            status=http_status.HTTP_403_FORBIDDEN,
            detail="Authentication credentials were not provided",
        )
    try:
        token = AccessToken(raw)
    except TokenError:
        raise ChunkedUploadError(
            status=http_status.HTTP_403_FORBIDDEN,
            detail="Authentication credentials were invalid",
        )
    user = User.objects.filter(id=token["user_id"]).first()
    if not user or not user.is_authenticated:
        raise ChunkedUploadError(
            status=http_status.HTTP_403_FORBIDDEN,
            detail="Authentication credentials were not provided",
        )
    return user


def generate_captions_wrapper(photo, commit=True):
    """Wrapper function to generate captions for use in chain"""
    caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
    caption_instance.generate_tag_captions(commit=commit)


class UploadPhotoExists(viewsets.ViewSet):
    def retrieve(self, request, pk):
        try:
            Photo.objects.get(image_hash=pk)
            return Response({"exists": True})
        except Photo.DoesNotExist:
            return Response({"exists": False})
        except Photo.MultipleObjectsReturned:
            # Multiple photos with same hash - photo exists
            return Response({"exists": True})


@method_decorator(csrf_exempt, name="dispatch")
class UploadPhotosChunked(ChunkedUploadView):
    model = ChunkedUpload

    def check_permissions(self, request):
        if not site_config.ALLOW_UPLOAD:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Uploading is not allowed",
            )
        # To-Do: Check if file is allowed type
        authenticate_upload_request(request)

    def create_chunked_upload(self, save=False, **attrs):
        """Creates new chunked upload instance. Called if no 'upload_id' is
        found in the POST data.
        """
        chunked_upload = self.model(**attrs)
        # file starts empty
        chunked_upload.file.save(name="tmp", content=ContentFile(""), save=save)
        return chunked_upload


@method_decorator(csrf_exempt, name="dispatch")
class UploadPhotosChunkedComplete(ChunkedUploadCompleteView):
    model = ChunkedUpload

    def check_permissions(self, request):
        if not site_config.ALLOW_UPLOAD:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Uploading is not allowed",
            )
        authenticate_upload_request(request)

    def on_completion(self, uploaded_file, request):
        user = authenticate_upload_request(request)

        # Validate that user has a configured scan directory
        if not user.scan_directory or user.scan_directory.strip() == "":
            raise ChunkedUploadError(
                status=http_status.HTTP_400_BAD_REQUEST,
                detail="Upload failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account.",
            )

        # Validate that the scan directory exists
        if not os.path.exists(user.scan_directory):
            raise ChunkedUploadError(
                status=http_status.HTTP_400_BAD_REQUEST,
                detail=f"Upload failed: Scan directory '{user.scan_directory}' does not exist. Please contact your administrator.",
            )

        if not is_valid_media(uploaded_file.file.path, user):
            chunked_upload = get_object_or_404(
                ChunkedUpload, upload_id=request.POST.get("upload_id")
            )
            # Release our handle on the staged file before removing it; a
            # still-open handle makes the delete fail outright on Windows and
            # leaks a descriptor everywhere else.
            uploaded_file.close()
            chunked_upload.delete(delete_file=True)
            raise ChunkedUploadError(
                status=http_status.HTTP_400_BAD_REQUEST,
                detail="File type not allowed",
            )

        # Sanitize file name
        filename = get_valid_filename(request.POST.get("filename"))

        # To-Do: Get origin device
        device = "web"

        if not os.path.exists(os.path.join(user.scan_directory, "uploads")):
            os.mkdir(os.path.join(user.scan_directory, "uploads"))
        if not os.path.exists(os.path.join(user.scan_directory, "uploads", device)):
            os.mkdir(os.path.join(user.scan_directory, "uploads", device))
        photo = uploaded_file
        image_hash = calculate_hash_b64(user, io.BytesIO(photo.read()))
        photo_path = ""

        if not Photo.objects.filter(image_hash=image_hash).exists():
            if not os.path.exists(
                os.path.join(user.scan_directory, "uploads", device, filename)
            ):
                photo_path = os.path.join(
                    user.scan_directory, "uploads", device, filename
                )
            else:
                existing_photo_hash = calculate_hash(
                    user, os.path.join(user.scan_directory, "uploads", device, filename)
                )

                file_name = os.path.splitext(os.path.basename(filename))[0]
                file_name_extension = os.path.splitext(os.path.basename(filename))[1]

                if existing_photo_hash == image_hash:
                    # File already exist, do not copy it in the upload folder
                    util.logger.info(
                        f"Photo {filename} duplicated with hash {image_hash} "
                    )
                else:
                    photo_path = os.path.join(
                        user.scan_directory,
                        "uploads",
                        device,
                        file_name + "_" + image_hash + file_name_extension,
                    )

        else:
            util.logger.info(f"Photo {filename} duplicated with hash {image_hash} ")

        if photo_path:
            with open(photo_path, "wb") as f:
                photo.seek(0)
                f.write(photo.read())

        chunked_upload = get_object_or_404(
            ChunkedUpload, upload_id=request.POST.get("upload_id")
        )
        uploaded_file.close()
        chunked_upload.delete(delete_file=True)

        if not photo_path:
            return Response(
                {"detail": "Photo duplicated. No new import performed."},
                status=http_status.HTTP_200_OK,
            )

        # Optional client-supplied capture time, used as a timestamp fallback
        # for photos that carry no EXIF date (doc 04 §5, issue #614).
        device_created_at = parse_device_timestamp(
            request.POST.get("device_created_at")
        )
        device_modified_at = parse_device_timestamp(
            request.POST.get("device_modified_at")
        )

        chain = Chain()
        photo = create_new_image(user, photo_path)
        chain.append(handle_new_image, user, photo_path, image_hash, photo)
        chain.append(
            apply_device_timestamp_fallback,
            photo,
            device_created_at,
            device_modified_at,
        )
        chain.append(generate_captions_wrapper, photo, True)
        chain.append(photo._geolocate)
        chain.append(photo._add_location_to_album_dates)
        chain.append(photo._extract_faces)
        chain.run()
