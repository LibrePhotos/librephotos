from django.db.models import Q
from django.utils import timezone
from django.utils.dateparse import parse_datetime
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.permissions import AllowAny
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import AlbumUser
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
