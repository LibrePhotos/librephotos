import os

import magic
from django.conf import settings
from django.db.models import Q
from django.http import HttpResponse
from django.utils.encoding import iri_to_uri
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import AlbumUser, Photo
from api.models.album_user_share import AlbumUserShare
from api.serializers.album_user import (
    AlbumUserListSerializer,
    AlbumUserPublicSerializer,
)


class SetUserAlbumPublic(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_public = data.get("val_public")
        album_id = data.get("album_id")
        slug = data.get("slug")
        expires_at = data.get("expires_at")  # ISO string or None
        if album_id is None or val_public is None:
            return Response(
                {"status": False, "message": "Missing parameters"}, status=400
            )

        try:
            album = AlbumUser.objects.get(id=album_id)
        except AlbumUser.DoesNotExist:
            return Response({"status": False, "message": "No such album"}, status=404)

        if album.owner != request.user:
            return Response(
                {"status": False, "message": "You are not the owner of this album"},
                status=403,
            )

        share, _ = AlbumUserShare.objects.get_or_create(album=album)
        share.enabled = bool(val_public)
        if slug is not None:
            share.slug = slug or None
        if expires_at is not None:
            try:
                dt = parse_datetime(expires_at)
                share.expires_at = dt
            except Exception:
                pass
        share.save()

        return Response({"status": True, "album": AlbumUserListSerializer(album).data})


class PublicAlbumMediaAccessView(APIView):
    permission_classes = (AllowAny,)

    def _get_protected_media_url(self, path, fname):
        return f"/protected_media/{path}/{fname}"

    def get(self, request, album_id, path, fname, format=None):
        image_hash = fname.split(".")[0].split("_")[0]
        # Album must be publicly shared and active
        album = (
            AlbumUser.objects.filter(
                id=album_id,
                share__enabled=True,
            )
            .filter(
                Q(share__expires_at__isnull=True)
                | Q(share__expires_at__gte=timezone.now())
            )
            .first()
        )
        if album is None:
            return HttpResponse(status=404)

        try:
            photo = album.photos.only(
                "image_hash", "video", "main_file", "thumbnail"
            ).get(image_hash=image_hash)
        except Photo.DoesNotExist:
            return HttpResponse(status=404)

        # Thumbnails and faces
        if "thumbnail" in path or "thumbnails" in path:
            response = HttpResponse()
            filename = os.path.splitext(photo.thumbnail.square_thumbnail.path)[1]
            if "jpg" in filename:
                response["Content-Type"] = "image/jpg"
                response["X-Accel-Redirect"] = photo.thumbnail.thumbnail_big.path
            if "webp" in filename:
                response["Content-Type"] = "image/webp"
                response["X-Accel-Redirect"] = self._get_protected_media_url(
                    path, fname + ".webp"
                )
            if "mp4" in filename:
                response["Content-Type"] = "video/mp4"
                response["X-Accel-Redirect"] = self._get_protected_media_url(
                    path, fname + ".mp4"
                )
            return response

        if "faces" in path:
            response = HttpResponse()
            response["Content-Type"] = "image/jpg"
            response["X-Accel-Redirect"] = self._get_protected_media_url(path, fname)
            return response

        # Originals and videos
        if photo.video:
            mime = magic.Magic(mime=True)
            filename = mime.from_file(photo.main_file.path)
            response = HttpResponse()
            response["Content-Type"] = filename
            response["X-Accel-Redirect"] = iri_to_uri(
                photo.main_file.path.replace(settings.DATA_ROOT, "/original")
            )
            return response

        response = HttpResponse()
        response["Content-Type"] = "image/webp"
        # Build internal path
        if photo.main_file.path.startswith(settings.PHOTOS):
            internal_path = "/original" + photo.main_file.path[len(settings.PHOTOS) :]
        else:
            internal_path = photo.main_file.path
        response["X-Accel-Redirect"] = iri_to_uri(internal_path)
        return response


class PublicAlbumBySlug(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[OpenApiParameter("slug", OpenApiTypes.STR)],
        description="Returns a public user album by slug if active",
    )
    def get(self, request, slug):
        album = (
            AlbumUser.objects.filter(Q(share__enabled=True) & Q(share__slug=slug))
            .filter(
                Q(share__expires_at__isnull=True)
                | Q(share__expires_at__gte=timezone.now())
            )
            .first()
        )
        if not album:
            return Response(status=404)
        serializer = AlbumUserPublicSerializer(album, context={"request": request})
        return Response({"results": serializer.data})
