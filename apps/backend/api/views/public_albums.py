from django.db.models import Q
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
from api.serializers.photos import PublicPhotoDetailSerializer


class SetUserAlbumPublic(APIView):
    def post(self, request, format=None):
        data = dict(request.data)
        val_public = data.get("val_public")
        album_id = data.get("album_id")
        slug = data.get("slug")
        expires_at = data.get("expires_at")  # ISO string or None
        
        # Sharing options - None means use user default, True/False overrides
        sharing_options = data.get("sharing_options", {})
        
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
        
        # Update sharing options if provided
        if sharing_options:
            # Each option can be True, False, or None (use default)
            if "share_location" in sharing_options:
                share.share_location = sharing_options.get("share_location")
            if "share_camera_info" in sharing_options:
                share.share_camera_info = sharing_options.get("share_camera_info")
            if "share_timestamps" in sharing_options:
                share.share_timestamps = sharing_options.get("share_timestamps")
            if "share_captions" in sharing_options:
                share.share_captions = sharing_options.get("share_captions")
            if "share_faces" in sharing_options:
                share.share_faces = sharing_options.get("share_faces")
        
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
            .select_related("share", "owner")
            .first()
        )
        if not album:
            return Response(status=404)
        
        # Include effective sharing settings in response
        sharing_settings = album.share.get_effective_sharing_settings()
        
        serializer = AlbumUserPublicSerializer(album, context={"request": request})
        return Response({
            "results": serializer.data,
            "sharing_settings": sharing_settings,
        })


class PublicPhotoDetailBySlug(APIView):
    """Get photo details for a photo in a publicly shared album."""
    
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter("slug", OpenApiTypes.STR, description="Album share slug"),
            OpenApiParameter("photo_id", OpenApiTypes.STR, description="Photo ID or image hash"),
        ],
        description="Returns photo details for a photo in a public album, filtered by sharing settings",
    )
    def get(self, request, slug, photo_id):
        # Find the public album
        album = (
            AlbumUser.objects.filter(Q(share__enabled=True) & Q(share__slug=slug))
            .filter(
                Q(share__expires_at__isnull=True)
                | Q(share__expires_at__gte=timezone.now())
            )
            .select_related("share", "owner")
            .first()
        )
        if not album:
            return Response({"error": "Album not found or not public"}, status=404)
        
        # Find the photo - support both UUID and image_hash lookups
        # UUID format is 36 chars with hyphens, image_hash is 32 hex chars
        is_uuid_format = len(photo_id) == 36 and photo_id.count("-") == 4
        
        if is_uuid_format:
            photo = album.photos.filter(
                pk=photo_id,
                hidden=False,
                in_trashcan=False,
            ).first()
        else:
            photo = album.photos.filter(
                image_hash=photo_id,
                hidden=False,
                in_trashcan=False,
            ).first()
        
        if not photo:
            return Response({"error": "Photo not found in album"}, status=404)
        
        # Get effective sharing settings
        sharing_settings = album.share.get_effective_sharing_settings()
        
        # Serialize with sharing settings in context
        serializer = PublicPhotoDetailSerializer(
            photo,
            context={"request": request, "sharing_settings": sharing_settings}
        )
        
        return Response({
            "results": serializer.data,
            "sharing_settings": sharing_settings,
        })
