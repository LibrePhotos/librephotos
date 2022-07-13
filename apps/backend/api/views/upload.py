import io
import os
import uuid

import django_rq
from chunked_upload.constants import http_status
from chunked_upload.exceptions import ChunkedUploadError
from chunked_upload.models import ChunkedUpload
from chunked_upload.views import ChunkedUploadCompleteView, ChunkedUploadView
from django.core.files.base import ContentFile
from django.shortcuts import get_object_or_404
from rest_framework import viewsets
from rest_framework.response import Response

from api.directory_watcher import calculate_hash_b64, handle_new_image
from api.models import Photo, User


class UploadPhotoExists(viewsets.ViewSet):
    def retrieve(self, request, pk):
        try:
            Photo.objects.get(image_hash=pk)
            return Response({"exists": True})
        except Photo.DoesNotExist:
            return Response({"exists": False})


class UploadPhotosChunked(ChunkedUploadView):

    model = ChunkedUpload

    def check_permissions(self, request):
        # To-Do: make deactivatable
        # To-Do: Maybe check jwt token here?
        # To-Do: Check if file is allowed type
        user = User.objects.filter(id=request.POST.get("user")).first()
        if not user or not user.is_authenticated:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Authentication credentials were not provided",
            )

    def create_chunked_upload(self, save=False, **attrs):
        """
        Creates new chunked upload instance. Called if no 'upload_id' is
        found in the POST data.
        """
        chunked_upload = self.model(**attrs)
        # file starts empty
        chunked_upload.file.save(name="tmp", content=ContentFile(""), save=save)
        return chunked_upload


class UploadPhotosChunkedComplete(ChunkedUploadCompleteView):

    model = ChunkedUpload

    def check_permissions(self, request):
        # To-Do: Maybe check jwt token here?
        user = User.objects.filter(id=request.POST.get("user")).first()
        if not user or not user.is_authenticated:
            raise ChunkedUploadError(
                status=http_status.HTTP_403_FORBIDDEN,
                detail="Authentication credentials were not provided",
            )

    def on_completion(self, uploaded_file, request):
        user = User.objects.filter(id=request.POST.get("user")).first()
        # To-Do: Sanatize file name
        filename = request.POST.get("filename")

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
                photo_path = os.path.join(
                    user.scan_directory, "uploads", device, image_hash
                )
            with open(photo_path, "wb") as f:
                photo.seek(0)
                f.write(photo.read())
            chunked_upload = get_object_or_404(
                ChunkedUpload, upload_id=request.POST.get("upload_id")
            )
            chunked_upload.delete(delete_file=True)

            # To-Do: Fix jobs not being queued / executed
            django_rq.enqueue(handle_new_image, user, photo_path, uuid.uuid4())
