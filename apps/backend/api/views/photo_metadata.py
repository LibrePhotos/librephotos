"""
API views for PhotoMetadata management.

Provides endpoints for:
- Viewing detailed metadata
- Editing metadata with history tracking
- Reverting metadata changes
- Viewing edit history
"""

from django.shortcuts import get_object_or_404
from drf_spectacular.utils import extend_schema, OpenApiParameter
from rest_framework.decorators import action
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView
from rest_framework.viewsets import ViewSet

from api.models import Photo
from api.models.photo_metadata import MetadataEdit, PhotoMetadata
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

    def _get_photo(self, request, photo_id: str) -> Photo:
        """Get photo by ID or image_hash, checking permissions."""
        # UUID format is 36 chars with 4 hyphens (xxxxxxxx-xxxx-xxxx-xxxx-xxxxxxxxxxxx)
        # MD5 hashes are 32 hex chars without hyphens
        # Python's uuid.UUID() accepts both, so we need to check format explicitly
        is_uuid_format = len(photo_id) == 36 and photo_id.count("-") == 4
        
        if is_uuid_format:
            photo = get_object_or_404(Photo, pk=photo_id)
        else:
            photo = get_object_or_404(Photo, image_hash=photo_id)
        
        # Check ownership
        if photo.owner != request.user and not request.user.is_staff:
            from rest_framework.exceptions import PermissionDenied
            raise PermissionDenied("You don't have permission to access this photo's metadata.")
        
        return photo

    def _get_or_create_metadata(self, photo: Photo) -> PhotoMetadata:
        """Get or create PhotoMetadata for a photo."""
        metadata, created = PhotoMetadata.objects.get_or_create(
            photo=photo,
            defaults={
                # If creating new, leave fields empty - they'll be populated on next scan
                "date_taken": photo.exif_timestamp,
                "gps_latitude": photo.exif_gps_lat,
                "gps_longitude": photo.exif_gps_lon,
                "rating": photo.rating,
                "source": PhotoMetadata.Source.EMBEDDED,
            }
        )
        return metadata

    @extend_schema(
        description="Get full structured metadata for a photo.",
        responses={200: PhotoMetadataSerializer},
    )
    def retrieve(self, request, photo_id: str):
        """Get full metadata for a photo."""
        photo = self._get_photo(request, photo_id)
        metadata = self._get_or_create_metadata(photo)
        serializer = PhotoMetadataSerializer(metadata)
        return Response(serializer.data)

    @extend_schema(
        description="Update photo metadata. Changes are tracked in edit history.",
        request=PhotoMetadataUpdateSerializer,
        responses={200: PhotoMetadataSerializer},
    )
    def partial_update(self, request, photo_id: str):
        """Update metadata with change tracking."""
        photo = self._get_photo(request, photo_id)
        metadata = self._get_or_create_metadata(photo)
        
        serializer = PhotoMetadataUpdateSerializer(
            metadata,
            data=request.data,
            partial=True,
            context={"request": request}
        )
        serializer.is_valid(raise_exception=True)
        serializer.save()
        
        # Return full metadata
        return Response(PhotoMetadataSerializer(metadata).data)

    @extend_schema(
        description="Get edit history for a photo's metadata.",
        responses={200: MetadataEditSerializer(many=True)},
    )
    @action(detail=True, methods=["get"], url_path="history")
    def history(self, request, photo_id: str):
        """Get edit history for a photo."""
        photo = self._get_photo(request, photo_id)
        edits = MetadataEdit.objects.filter(photo=photo).order_by("-created_at")
        
        # Pagination
        page = int(request.query_params.get("page", 1))
        page_size = int(request.query_params.get("page_size", 20))
        start = (page - 1) * page_size
        end = start + page_size
        
        serializer = MetadataEditSerializer(edits[start:end], many=True)
        return Response({
            "results": serializer.data,
            "count": edits.count(),
            "page": page,
            "page_size": page_size,
        })

    @extend_schema(
        description="Revert a specific metadata edit.",
        responses={200: PhotoMetadataSerializer},
    )
    @action(detail=True, methods=["post"], url_path=r"revert/(?P<edit_id>[^/.]+)")
    def revert(self, request, photo_id: str, edit_id: str):
        """Revert a specific metadata edit."""
        photo = self._get_photo(request, photo_id)
        edit = get_object_or_404(MetadataEdit, pk=edit_id, photo=photo)
        
        # Get or create metadata
        metadata = self._get_or_create_metadata(photo)
        
        # Restore the old value
        field_name = edit.field_name
        old_value = edit.old_value
        current_value = getattr(metadata, field_name, None)
        
        # Create a new edit record for the revert
        MetadataEdit.objects.create(
            photo=photo,
            user=request.user,
            field_name=field_name,
            old_value=current_value,
            new_value=old_value,
        )
        
        # Apply the revert
        setattr(metadata, field_name, old_value)
        metadata.version += 1
        metadata.save()
        
        return Response(PhotoMetadataSerializer(metadata).data)

    @extend_schema(
        description="Revert all edits and restore original embedded metadata.",
        responses={200: PhotoMetadataSerializer},
    )
    @action(detail=True, methods=["post"], url_path="revert-all")
    def revert_all(self, request, photo_id: str):
        """Revert all edits and restore original metadata from file by re-extracting EXIF."""
        photo = self._get_photo(request, photo_id)
        
        try:
            metadata = photo.metadata
            # Record the revert
            MetadataEdit.objects.create(
                photo=photo,
                user=request.user,
                field_name="_all",
                old_value={"action": "revert_all"},
                new_value={"source": "embedded"},
            )
            
            # Re-extract EXIF data from the file to restore original values
            # This will update PhotoMetadata with fresh data from the image file
            PhotoMetadata.extract_exif_data(photo, commit=True)
            
            # Refresh metadata from database
            metadata.refresh_from_db()
            metadata.source = PhotoMetadata.Source.EMBEDDED
            metadata.version += 1
            metadata.save()
            
        except PhotoMetadata.DoesNotExist:
            # If no metadata exists, extract it fresh
            metadata = PhotoMetadata.extract_exif_data(photo, commit=True)
        
        return Response(PhotoMetadataSerializer(metadata).data)


class BulkMetadataView(APIView):
    """
    Bulk metadata operations for multiple photos.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        description="Get metadata summary for multiple photos.",
        parameters=[
            OpenApiParameter("photo_ids", str, description="Comma-separated photo IDs or image hashes"),
        ],
    )
    def get(self, request):
        """Get metadata summary for multiple photos."""
        photo_ids = request.query_params.get("photo_ids", "").split(",")
        photo_ids = [pid.strip() for pid in photo_ids if pid.strip()]
        
        if not photo_ids:
            return Response({"error": "No photo_ids provided"}, status=400)
        
        if len(photo_ids) > 100:
            return Response({"error": "Maximum 100 photos per request"}, status=400)
        
        # Get photos (by UUID or image_hash)
        from django.db.models import Q
        import uuid
        
        uuid_ids = []
        hash_ids = []
        for pid in photo_ids:
            try:
                uuid.UUID(pid)
                uuid_ids.append(pid)
            except (ValueError, AttributeError):
                hash_ids.append(pid)
        
        photos = Photo.objects.filter(
            Q(pk__in=uuid_ids) | Q(image_hash__in=hash_ids),
            owner=request.user,
        ).select_related("metadata")
        
        results = {}
        for photo in photos:
            try:
                metadata = photo.metadata
                results[str(photo.id)] = {
                    "camera": metadata.camera_display,
                    "lens": metadata.lens_display,
                    "date_taken": metadata.date_taken,
                    "has_location": metadata.has_location,
                    "rating": metadata.rating,
                }
            except PhotoMetadata.DoesNotExist:
                # No metadata exists - return minimal info with None values
                results[str(photo.id)] = {
                    "camera": None,
                    "lens": None,
                    "date_taken": photo.exif_timestamp,
                    "has_location": photo.exif_gps_lat is not None,
                    "rating": photo.rating,
                }
        
        return Response(results)

    @extend_schema(
        description="Update metadata for multiple photos.",
    )
    def patch(self, request):
        """Bulk update metadata for multiple photos."""
        photo_ids = request.data.get("photo_ids", [])
        updates = request.data.get("updates", {})
        
        if not photo_ids:
            return Response({"error": "No photo_ids provided"}, status=400)
        
        if not updates:
            return Response({"error": "No updates provided"}, status=400)
        
        if len(photo_ids) > 100:
            return Response({"error": "Maximum 100 photos per request"}, status=400)
        
        # Validate allowed fields
        allowed_fields = {"title", "caption", "keywords", "rating", "copyright", "creator"}
        invalid_fields = set(updates.keys()) - allowed_fields
        if invalid_fields:
            return Response(
                {"error": f"Invalid fields: {invalid_fields}. Allowed: {allowed_fields}"},
                status=400
            )
        
        # Get photos
        from django.db.models import Q
        import uuid
        
        uuid_ids = []
        hash_ids = []
        for pid in photo_ids:
            try:
                uuid.UUID(str(pid))
                uuid_ids.append(pid)
            except (ValueError, AttributeError):
                hash_ids.append(pid)
        
        photos = Photo.objects.filter(
            Q(pk__in=uuid_ids) | Q(image_hash__in=hash_ids),
            owner=request.user,
        )
        
        updated_count = 0
        for photo in photos:
            metadata, _ = PhotoMetadata.objects.get_or_create(photo=photo)
            
            for field_name, new_value in updates.items():
                old_value = getattr(metadata, field_name, None)
                if old_value != new_value:
                    MetadataEdit.objects.create(
                        photo=photo,
                        user=request.user,
                        field_name=field_name,
                        old_value=old_value,
                        new_value=new_value,
                    )
                    setattr(metadata, field_name, new_value)
            
            metadata.source = PhotoMetadata.Source.USER_EDIT
            metadata.version += 1
            metadata.save()
            updated_count += 1
        
        return Response({
            "updated_count": updated_count,
            "message": f"Updated metadata for {updated_count} photos",
        })
