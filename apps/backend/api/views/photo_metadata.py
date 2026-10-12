"""
API views for PhotoMetadata management.

Provides endpoints for:
- Viewing detailed metadata
- Editing metadata with history tracking
- Reverting metadata changes
- Viewing edit history
"""

import uuid

from django.db.models import Q
from django.http import Http404
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework.decorators import action
from rest_framework.exceptions import ValidationError
from rest_framework.generics import get_object_or_404
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet

from api.exceptions import EditSuperseded
from api.metadata import edits
from api.models import Photo
from api.models.photo_metadata import MetadataEdit, PhotoMetadata
from api.request_data import request_dict
from api.request_user import request_user
from api.serializers.photo_metadata import (
    MetadataEditSerializer,
    PhotoMetadataSerializer,
    PhotoMetadataUpdateSerializer,
)


class PhotoMetadataViewSet(ViewSet):
    """
    ViewSet for photo metadata operations.

    Provides:
    - GET /api/photos/{photo_id}/metadata/ - Get full metadata
    - PATCH /api/photos/{photo_id}/metadata/ - Update metadata (creates history)
    - GET /api/photos/{photo_id}/metadata/history/ - Get edit history
    - POST /api/photos/{photo_id}/metadata/revert/{edit_id}/ - Revert a change
    """

    permission_classes = [IsAuthenticated]

    def _get_photo(self, request: Request, photo_id: str) -> Photo:
        """Get photo by ID or image_hash, checking permissions."""
        # UUID format is 36 chars with 4 hyphens (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
        # MD5 hashes are 32 hex chars without hyphens
        # Python's uuid.UUID() accepts both, so we need to check format explicitly
        is_uuid_format = len(photo_id) == 36 and photo_id.count("-") == 4
        user = request_user(request)

        # Staff may read and edit any photo's metadata. Everyone else only
        # looks among their own photos, so another user's photo is a 404 like
        # an unknown one: a 403 would confirm it exists, and image_hash (the
        # file's MD5 plus the owner id) is computable by anyone with the file.
        if user.is_staff:
            photos = Photo.objects.all()
        else:
            photos = Photo.objects.owned_by(user)

        if is_uuid_format:
            # DRF's get_object_or_404: a malformed UUID is a 404, not a 500.
            return get_object_or_404(photos, pk=photo_id)
        # image_hash is not unique (two users who scan the same file share
        # one), so .get() could raise MultipleObjectsReturned: prefer the
        # requester's own row.
        matches = photos.filter(image_hash=photo_id)
        photo = matches.owned_by(user).first() or matches.first()
        if photo is None:
            raise Http404
        return photo

    def _get_or_create_metadata(self, photo: Photo) -> PhotoMetadata:
        """Get or create PhotoMetadata for a photo.

        A new row is empty; the next scan fills it. Date, location, rating
        and caption are read from the photo itself (#2252).
        """
        metadata, created = PhotoMetadata.objects.get_or_create(
            photo=photo, defaults={"source": PhotoMetadata.Source.EMBEDDED}
        )
        return metadata

    def _response(self, photo: Photo) -> Response:
        """The photo's full metadata, read fresh after an edit."""
        metadata = PhotoMetadata.objects.select_related("photo").get(photo=photo)
        return Response(PhotoMetadataSerializer(metadata).data)

    @extend_schema(
        description="Get full structured metadata for a photo.",
        responses={200: PhotoMetadataSerializer},
    )
    def retrieve(self, request: Request, photo_id: str) -> Response:
        """Get full metadata for a photo."""
        photo = self._get_photo(request, photo_id)
        metadata = self._get_or_create_metadata(photo)
        serializer = PhotoMetadataSerializer(metadata)
        return Response(serializer.data)

    @extend_schema(
        description=(
            "Update photo metadata. Changes are tracked in edit history. rating, "
            "caption, keywords, title, copyright and creator; the date and the "
            "location are a 400 here (PATCH /api/photos/edit/{image_hash}/)."
        ),
        request=PhotoMetadataUpdateSerializer,
        responses={200: PhotoMetadataSerializer},
    )
    def partial_update(self, request: Request, photo_id: str) -> Response:
        """Update metadata with change tracking."""
        photo = self._get_photo(request, photo_id)
        self._get_or_create_metadata(photo)

        serializer = PhotoMetadataUpdateSerializer(data=request.data)
        serializer.is_valid(raise_exception=True)
        edits.apply_updates(
            Photo.objects.filter(pk=photo.pk),
            serializer.validated_data,
            request_user(request),
        )
        return self._response(photo)

    @extend_schema(
        description="Get edit history for a photo's metadata.",
        responses={200: MetadataEditSerializer(many=True)},
    )
    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request: Request, photo_id: str) -> Response:
        """Get edit history for a photo."""
        photo = self._get_photo(request, photo_id)
        # -id tiebreaks edits sharing a created_at so paging is stable; see
        # MetadataEdit.Meta.
        edits = MetadataEdit.objects.filter(photo=photo).order_by("-created_at", "-id")

        # Pagination; a malformed or out-of-range value falls back, as in
        # PhotoStackListView, instead of a 500 (a negative slice raises).
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (TypeError, ValueError):
            page = 1
        try:
            page_size = max(1, min(int(request.query_params.get("page_size", 20)), 100))
        except (TypeError, ValueError):
            page_size = 20
        start = (page - 1) * page_size
        end = start + page_size

        serializer = MetadataEditSerializer(edits[start:end], many=True)
        return Response(
            {
                "results": serializer.data,
                "count": edits.count(),
                "page": page,
                "page_size": page_size,
            }
        )

    @extend_schema(
        description=(
            "Revert a specific metadata edit. 400 if the edit is not of an "
            "editable field (e.g. the revert-all marker); 409 if the field was "
            "changed again afterwards, unless ?force=1."
        ),
        parameters=[
            OpenApiParameter(
                "force",
                str,
                description="1 to revert even if the field was changed again later",
            ),
        ],
        responses={200: PhotoMetadataSerializer},
    )
    @action(detail=True, methods=["post"], url_path=r"revert/(?P<edit_id>[^/.]+)")
    def revert(self, request: Request, photo_id: str, edit_id: str) -> Response:
        """Revert a specific metadata edit."""
        photo = self._get_photo(request, photo_id)
        edit = get_object_or_404(MetadataEdit, pk=edit_id, photo=photo)

        # Only edits of a field the metadata API can write are revertible. An
        # "_all" row is the revert-all marker: "reverting" it would setattr a
        # non-field and record a new "_all" row, which _user_edited would take
        # as a fresh restore-from-file boundary without re-reading the file.
        field_name = edit.field_name
        if field_name not in edits.REVERTIBLE_FIELDS:
            raise ValidationError(
                {"field_name": f"An edit of '{field_name}' cannot be reverted."}
            )

        # Reverting an older edit overwrites every later change of the same
        # field, including a revert-all that restored the file's value: refuse
        # unless the caller says so.
        force = request.query_params.get("force", "").lower() in {"1", "true"}
        superseded = (
            MetadataEdit.objects.filter(photo=photo, created_at__gt=edit.created_at)
            .filter(Q(field_name=field_name) | Q(field_name=edits.REVERT_ALL))
            .exists()
        )
        if superseded and not force:
            raise EditSuperseded()

        self._get_or_create_metadata(photo)
        # The revert goes through the field's setter, which records it as an
        # edit of its own.
        try:
            edits.revert_to(photo, field_name, edit.old_value, request_user(request))
        except edits.InvalidEditValueError as error:
            raise ValidationError({"old_value": str(error)}) from error
        return self._response(photo)

    @extend_schema(
        description=(
            "Restore every editable field (date, location, rating, caption, "
            "keywords, title, copyright, creator) from the file and its "
            "sidecar; a field the file says nothing about is emptied."
        ),
        responses={200: PhotoMetadataSerializer},
    )
    @action(detail=True, methods=["post"], url_path="revert-all")
    def revert_all(self, request: Request, photo_id: str) -> Response:
        """Revert all edits by re-reading the photo's file."""
        photo = self._get_photo(request, photo_id)
        if photo.main_file is None:
            raise ValidationError({"photo": "The photo has no file to restore from."})
        edits.revert_all(photo, request_user(request))
        return self._response(photo)


class BulkMetadataView(APIView):
    """
    Bulk metadata operations for multiple photos.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        description="Get metadata summary for multiple photos.",
        parameters=[
            OpenApiParameter(
                "photo_ids",
                str,
                description="Comma-separated photo IDs or image hashes",
            ),
        ],
    )
    def get(self, request: Request) -> Response:
        """Get metadata summary for multiple photos."""
        photo_ids = request.query_params.get("photo_ids", "").split(",")
        photo_ids = [pid.strip() for pid in photo_ids if pid.strip()]

        if not photo_ids:
            raise ValidationError("No photo_ids provided")

        if len(photo_ids) > 100:
            raise ValidationError("Maximum 100 photos per request")

        # Get photos (by UUID or image_hash)
        uuid_ids = []
        hash_ids = []
        for pid in photo_ids:
            # UUID format: 36 chars with 4 hyphens (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
            # MD5 hashes are 32 hex chars without hyphens
            # Note: uuid.UUID() accepts both formats, so we must check explicitly
            is_uuid_format = len(pid) == 36 and pid.count("-") == 4
            if is_uuid_format:
                try:
                    uuid.UUID(pid)
                    uuid_ids.append(pid)
                except (ValueError, AttributeError):
                    hash_ids.append(pid)
            else:
                hash_ids.append(pid)

        photos = (
            Photo.objects.owned_by(request_user(request))
            .filter(Q(pk__in=uuid_ids) | Q(image_hash__in=hash_ids))
            .select_related("metadata")
        )

        results: dict[str, dict[str, object]] = {}
        for photo in photos:
            try:
                metadata: PhotoMetadata | None = photo.metadata
            except PhotoMetadata.DoesNotExist:
                metadata = None
            results[str(photo.id)] = {
                "camera": metadata.camera_display if metadata else None,
                "lens": metadata.lens_display if metadata else None,
                # Date, location and rating live on the photo (#2252).
                "date_taken": photo.exif_timestamp,
                "has_location": photo.exif_gps_lat is not None
                and photo.exif_gps_lon is not None,
                "rating": photo.rating,
            }

        return Response(results)

    @extend_schema(
        description=(
            "Update metadata for up to 100 photos: the fields of the single "
            "PATCH, validated the same way."
        ),
    )
    def patch(self, request: Request) -> Response:
        """Bulk update metadata for multiple photos."""
        data = request_dict(request)
        photo_ids = data.get("photo_ids", [])
        updates = data.get("updates", {})

        if not isinstance(photo_ids, list) or not all(
            isinstance(pid, str) for pid in photo_ids
        ):
            raise ValidationError({"photo_ids": "Expected a list of photo ids."})
        if not photo_ids:
            raise ValidationError({"photo_ids": "No photo_ids provided."})
        if len(photo_ids) > 100:
            raise ValidationError({"photo_ids": "Maximum 100 photos per request."})
        if not isinstance(updates, dict) or not updates:
            raise ValidationError({"updates": "No updates provided."})

        allowed_fields = set(PhotoMetadataUpdateSerializer().fields)
        invalid_fields = sorted(
            set(updates)
            - allowed_fields
            - set(PhotoMetadataUpdateSerializer.MOVED_FIELDS)
        )
        if invalid_fields:
            raise ValidationError(
                {
                    field: f"Not an editable field. Allowed: {sorted(allowed_fields)}."
                    for field in invalid_fields
                }
            )
        serializer = PhotoMetadataUpdateSerializer(data=updates)
        serializer.is_valid(raise_exception=True)

        uuid_ids = []
        hash_ids = []
        for pid in photo_ids:
            # UUID format: 36 chars with 4 hyphens
            is_uuid_format = len(pid) == 36 and pid.count("-") == 4
            if is_uuid_format:
                try:
                    uuid.UUID(pid)
                    uuid_ids.append(pid)
                except (ValueError, AttributeError):
                    hash_ids.append(pid)
            else:
                hash_ids.append(pid)

        user = request_user(request)
        photos = Photo.objects.owned_by(user).filter(
            Q(pk__in=uuid_ids) | Q(image_hash__in=hash_ids)
        )
        updated = edits.apply_updates(photos, serializer.validated_data, user)

        return Response(
            {
                "updated_count": len(updated),
                "message": f"Updated metadata for {len(updated)} photos",
            }
        )
