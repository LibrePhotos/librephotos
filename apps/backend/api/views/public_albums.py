from typing import Any

from django.core.exceptions import ValidationError as DjangoValidationError
from django.core.validators import validate_slug
from django.db import IntegrityError, transaction
from django.db.models import Q
from django.utils import timezone
from drf_spectacular.utils import OpenApiParameter, OpenApiTypes, extend_schema
from rest_framework.exceptions import NotFound, PermissionDenied, ValidationError
from rest_framework.permissions import AllowAny, IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.exceptions import Conflict
from api.drf.params import parse_body
from api.drf.request_user import request_user
from api.models import AlbumUser
from api.models.album_user_share import AlbumUserShare
from api.serializers.album_user import (
    AlbumUserPublicSerializer,
    SetUserAlbumPublicRequest,
    album_user_card,
)
from api.serializers.photos import PublicPhotoDetailSerializer

SHARING_OPTION_FIELDS = (
    "share_location",
    "share_camera_info",
    "share_timestamps",
    "share_captions",
    "share_faces",
)


class SetUserAlbumPublic(APIView):
    permission_classes = (IsAuthenticated,)

    @extend_schema(request=SetUserAlbumPublicRequest)
    def post(self, request: Request, format: str | None = None) -> Response:
        data = parse_body(request, SetUserAlbumPublicRequest)
        album_id = data["album_id"]
        val_public = data["val_public"]

        try:
            album = AlbumUser.objects.get(id=album_id)
        except AlbumUser.DoesNotExist as error:
            raise NotFound("No such album") from error

        if album.owner != request_user(request):
            raise PermissionDenied("You are not the owner of this album")

        slug = data.get("slug")
        if val_public and slug:
            data["slug"] = slug = slug.strip()
            self._check_slug(album, slug)

        share, _ = AlbumUserShare.objects.get_or_create(album=album)
        share.enabled = val_public
        self._apply_share_settings(share, data)
        if not share.enabled:
            # Revoking has to actually revoke. Keeping the slug means the next
            # time the album is made public it is handed out under the very
            # same URL, so everyone the withdrawn link ever reached silently
            # gets access again (issue #76). Dropping it makes save() mint a
            # fresh random one on the next enable.
            share.slug = None
        try:
            # A savepoint, so a slug taken in a race does not break the request.
            with transaction.atomic():
                share.save()
        except IntegrityError as error:
            raise self._slug_taken() from error

        return Response({"status": True, "album": album_user_card(album)})

    @staticmethod
    def _slug_taken() -> Conflict:
        return Conflict("Slug already in use", code="slug_taken")

    def _check_slug(self, album: AlbumUser, slug: str) -> None:
        """A 400 for a slug that is not one, a 409 for one another album holds.

        save() does not run the SlugField's validators, and the UI's
        availability check asks the public link, which answers 404 for an
        expired share that still holds its slug: saving then hit the unique
        constraint and answered 500.
        """
        try:
            validate_slug(slug)
            max_length = AlbumUserShare._meta.get_field("slug").max_length
            # The slug field is declared with max_length=64, so never None.
            assert max_length is not None
            valid = len(slug) <= max_length
        except DjangoValidationError:
            valid = False
        if not valid:
            raise ValidationError({"slug": "Invalid slug"})
        if AlbumUserShare.objects.filter(slug=slug).exclude(album=album).exists():
            raise self._slug_taken()

    def _apply_share_settings(
        self, share: AlbumUserShare, data: dict[str, Any]
    ) -> None:
        slug = data.get("slug")
        if slug is not None:
            share.slug = slug or None

        # A date-time sets the expiry, null clears it (the web client sends
        # null for an emptied field), absent keeps it.
        if "expires_at" in data:
            share.expires_at = data["expires_at"]

        # Each option can be True, False, or None (use default)
        sharing_options = data.get("sharing_options") or {}
        for field in SHARING_OPTION_FIELDS:
            if field in sharing_options:
                setattr(share, field, sharing_options[field])


class PublicAlbumBySlug(APIView):
    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[OpenApiParameter("slug", OpenApiTypes.STR)],
        description="Returns a public user album by slug if active",
    )
    def get(self, request: Request, slug: str) -> Response:
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
            raise NotFound()

        # Include effective sharing settings in response
        sharing_settings = album.share.get_effective_sharing_settings()

        serializer = AlbumUserPublicSerializer(album, context={"request": request})
        return Response(
            {
                "results": serializer.data,
                "sharing_settings": sharing_settings,
            }
        )


class PublicPhotoDetailBySlug(APIView):
    """Get photo details for a photo in a publicly shared album."""

    permission_classes = [AllowAny]

    @extend_schema(
        parameters=[
            OpenApiParameter("slug", OpenApiTypes.STR, description="Album share slug"),
            OpenApiParameter(
                "photo_id", OpenApiTypes.STR, description="Photo ID or image hash"
            ),
        ],
        description="Returns photo details for a photo in a public album, filtered by sharing settings",
    )
    def get(self, request: Request, slug: str, photo_id: str) -> Response:
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
            raise NotFound("Album not found or not public")

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
            raise NotFound("Photo not found in album")

        # Get effective sharing settings
        sharing_settings = album.share.get_effective_sharing_settings()

        # Serialize with sharing settings in context
        serializer = PublicPhotoDetailSerializer(
            photo, context={"request": request, "sharing_settings": sharing_settings}
        )

        return Response(
            {
                "results": serializer.data,
                "sharing_settings": sharing_settings,
            }
        )
