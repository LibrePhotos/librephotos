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
from api.models import Photo, User
from api.models.file import calculate_hash, calculate_hash_b64
from api.models.photo_caption import PhotoCaption


def generate_captions_wrapper(photo, commit=True):
    """Wrapper function to generate captions for use in chain"""
    caption_instance, created = PhotoCaption.objects.get_or_create(photo=photo)
    caption_instance.generate_tag_captions(commit=commit)


def _forbidden(detail):
    return ChunkedUploadError(
        status=http_status.HTTP_403_FORBIDDEN,
        detail=detail,
    )


def _bad_request(detail):
    return ChunkedUploadError(
        status=http_status.HTTP_400_BAD_REQUEST,
        detail=detail,
    )


def authenticate_upload_request(request):
    jwt = request.COOKIES.get("jwt")
    if jwt is None:
        raise _forbidden("Authentication credentials were not provided")
    try:
        token = AccessToken(jwt)
    except TokenError:
        raise _forbidden("Authentication credentials were invalid")
    user = User.objects.filter(id=token["user_id"]).first()
    if not user:
        raise _forbidden("Authentication credentials were not provided")
    return user


def validate_scan_directory(user):
    if not user.scan_directory or user.scan_directory.strip() == "":
        raise _bad_request(
            "Upload failed: No scan directory configured. Please contact your administrator to set up a scan directory for your account."
        )
    if not os.path.exists(user.scan_directory):
        raise _bad_request(
            f"Upload failed: Scan directory '{user.scan_directory}' does not exist. Please contact your administrator."
        )


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
            raise _forbidden("Uploading is not allowed")
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
            raise _forbidden("Uploading is not allowed")
        authenticate_upload_request(request)

    def delete_chunked_upload(self, request):
        chunked_upload = get_object_or_404(
            ChunkedUpload, upload_id=request.POST.get("upload_id")
        )
        chunked_upload.delete(delete_file=True)

    def target_path(self, user, device, filename, image_hash):
        """Destination for the upload, or "" when it is a known duplicate."""
        if Photo.objects.filter(image_hash=image_hash).exists():
            util.logger.info(f"Photo {filename} duplicated with hash {image_hash} ")
            return ""

        upload_dir = os.path.join(user.scan_directory, "uploads", device)
        photo_path = os.path.join(upload_dir, filename)
        if not os.path.exists(photo_path):
            return photo_path

        if calculate_hash(user, photo_path) == image_hash:
            # File already exist, do not copy it in the upload folder
            util.logger.info(f"Photo {filename} duplicated with hash {image_hash} ")
            return ""

        file_name, file_name_extension = os.path.splitext(os.path.basename(filename))
        return os.path.join(
            upload_dir, file_name + "_" + image_hash + file_name_extension
        )

    def import_photo(self, user, photo_path, image_hash):
        chain = Chain()
        photo = create_new_image(user, photo_path)
        chain.append(handle_new_image, user, photo_path, image_hash, photo)
        chain.append(generate_captions_wrapper, photo, True)
        chain.append(photo._geolocate)
        chain.append(photo._add_location_to_album_dates)
        chain.append(photo._extract_faces)
        chain.run()

    def on_completion(self, uploaded_file, request):
        user = authenticate_upload_request(request)
        validate_scan_directory(user)

        if not is_valid_media(uploaded_file.file.path, user):
            self.delete_chunked_upload(request)
            raise _bad_request("File type not allowed")

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
        photo_path = self.target_path(user, device, filename, image_hash)

        if photo_path:
            with open(photo_path, "wb") as f:
                photo.seek(0)
                f.write(photo.read())

        self.delete_chunked_upload(request)

        if not photo_path:
            return Response(
                {"detail": "Photo duplicated. No new import performed."},
                status=http_status.HTTP_200_OK,
            )

        self.import_photo(user, photo_path, image_hash)
