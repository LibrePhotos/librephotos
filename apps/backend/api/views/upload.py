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


class UploadPhotoExists(viewsets.ViewSet):
    def retrieve(self, request, pk):
        try:
            Photo.objects.get(image_hash=pk)
            return Response({"exists": True})
        except Photo.DoesNotExist:
            return Response({"exists": False})


@method_decorator(csrf_exempt, name="dispatch")
class UploadPhotosChunked(ChunkedUploadView):
    model = ChunkedUpload

    def check_permissions(self, request):
        if not site_config.ALLOW_UPLOAD:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Uploading is not allowed",
            )
        jwt = request.COOKIES.get("jwt")
        if jwt is not None:
            try:
                token = AccessToken(jwt)
            except TokenError:
                raise ChunkedUploadError(
                    status=http_status.HTTP_403_FORBIDDEN,
                    detail="Authentication credentials were invalid",
                )
        else:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Authentication credentials were not provided",
            )
        # To-Do: Check if file is allowed type
        user = User.objects.filter(id=token["user_id"]).first()
        if not user or not user.is_authenticated:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Authentication credentials were not provided",
            )

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
        jwt = request.COOKIES.get("jwt")
        if jwt is not None:
            try:
                token = AccessToken(jwt)
            except TokenError:
                raise ChunkedUploadError(
                    status=http_status.HTTP_403_FORBIDDEN,
                    detail="Authentication credentials were invalid",
                )
        else:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Authentication credentials were not provided",
            )
        user = User.objects.filter(id=token["user_id"]).first()
        if not user or not user.is_authenticated:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Authentication credentials were not provided",
            )

    def on_completion(self, uploaded_file, request):
        jwt = request.COOKIES.get("jwt")
        if jwt is not None:
            try:
                token = AccessToken(jwt)
            except TokenError:
                raise ChunkedUploadError(
                    status=http_status.HTTP_403_FORBIDDEN,
                    detail="Authentication credentials were invalid",
                )
        else:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Authentication credentials were not provided",
            )

        if not is_valid_media(uploaded_file):
            chunked_upload = get_object_or_404(
                ChunkedUpload, upload_id=request.POST.get("upload_id")
            )
            chunked_upload.delete(delete_file=True)
            raise ChunkedUploadError(
                status=http_status.HTTP_400_BAD_REQUEST,
                detail="File type not allowed",
            )

        user = User.objects.filter(id=token["user_id"]).first()
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
                    photo_path = ""
                else:
                    photo_path = os.path.join(
                        user.scan_directory,
                        "uploads",
                        device,
                        file_name + "_" + image_hash + file_name_extension,
                    )

            if photo_path:
                with open(photo_path, "wb") as f:
                    photo.seek(0)
                    f.write(photo.read())
            chunked_upload = get_object_or_404(
                ChunkedUpload, upload_id=request.POST.get("upload_id")
            )
            chunked_upload.delete(delete_file=True)
            chain = Chain()
            photo = create_new_image(user, photo_path)
            chain.append(handle_new_image, user, photo_path, image_hash, photo)
            chain.append(photo._generate_captions, True)
            chain.append(photo._geolocate)
            chain.append(photo._add_location_to_album_dates)
            chain.append(photo._extract_faces)
            chain.run()

        else:
            util.logger.info(f"Photo {filename} duplicated with hash {image_hash} ")
