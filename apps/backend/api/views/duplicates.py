"""
API views for duplicate detection and management.
"""

from django.core.paginator import Paginator
from django.db.models import Count
from django_q.tasks import async_task
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.duplicate_detection import (
    batch_detect_duplicates,
    dismiss_duplicate_group,
    resolve_duplicate_group,
)
from api.models.duplicate_group import DuplicateGroup
from api.perceptual_hash import DEFAULT_HAMMING_THRESHOLD
from api.serializers.duplicates import (
    DuplicateGroupListSerializer,
    DuplicateGroupSerializer,
    ResolveDuplicateGroupSerializer,
)
from api.util import logger


class DuplicateGroupListView(APIView):
    """List all duplicate groups for the current user with pagination."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "status",
                str,
                description="Filter by status: pending, reviewed, dismissed",
            ),
            OpenApiParameter(
                "page",
                int,
                description="Page number (default: 1)",
            ),
            OpenApiParameter(
                "page_size",
                int,
                description="Number of items per page (default: 20, max: 100)",
            ),
        ],
        responses={200: DuplicateGroupListSerializer(many=True)},
    )
    def get(self, request):
        status_filter = request.query_params.get("status", None)
        page = int(request.query_params.get("page", 1))
        page_size = min(int(request.query_params.get("page_size", 20)), 100)

        groups = DuplicateGroup.objects.filter(owner=request.user).prefetch_related(
            "photos__thumbnail"
        ).annotate(
            photos_count=Count("photos")
        ).order_by("-created_at")

        if status_filter:
            groups = groups.filter(status=status_filter)

        # Only return groups with at least 2 photos
        groups = groups.filter(photos_count__gte=2)

        # Paginate results
        paginator = Paginator(groups, page_size)
        page_obj = paginator.get_page(page)

        serializer = DuplicateGroupListSerializer(page_obj.object_list, many=True)
        return Response({
            "results": serializer.data,
            "count": paginator.count,
            "num_pages": paginator.num_pages,
            "page": page,
            "page_size": page_size,
            "has_next": page_obj.has_next(),
            "has_previous": page_obj.has_previous(),
        })


class DuplicateGroupDetailView(APIView):
    """Get details of a specific duplicate group."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: DuplicateGroupSerializer})
    def get(self, request, group_id):
        try:
            group = DuplicateGroup.objects.annotate(photos_count=Count("photos")).get(
                id=group_id, owner=request.user
            )
        except DuplicateGroup.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        serializer = DuplicateGroupSerializer(group)
        return Response(serializer.data)


class ResolveDuplicateGroupView(APIView):
    """Resolve a duplicate group by keeping one photo and optionally trashing others."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=ResolveDuplicateGroupSerializer,
        responses={200: {"description": "Group resolved successfully"}},
    )
    def post(self, request, group_id):
        try:
            group = DuplicateGroup.objects.get(id=group_id, owner=request.user)
        except DuplicateGroup.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        serializer = ResolveDuplicateGroupSerializer(data=request.data)
        if not serializer.is_valid():
            return Response(serializer.errors, status=status.HTTP_400_BAD_REQUEST)

        keep_photo_hash = serializer.validated_data["keep_photo_hash"]
        trash_others = serializer.validated_data.get("trash_others", True)

        try:
            trashed_count = resolve_duplicate_group(group, keep_photo_hash, trash_others)
            return Response(
                {
                    "status": "resolved",
                    "kept_photo": keep_photo_hash,
                    "trashed_count": trashed_count,
                }
            )
        except ValueError as e:
            return Response({"error": str(e)}, status=status.HTTP_400_BAD_REQUEST)


class DismissDuplicateGroupView(APIView):
    """Dismiss a duplicate group (mark as not duplicates)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={200: {"description": "Group dismissed successfully"}},
    )
    def post(self, request, group_id):
        try:
            group = DuplicateGroup.objects.get(id=group_id, owner=request.user)
        except DuplicateGroup.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        dismiss_duplicate_group(group)
        return Response({"status": "dismissed"})


class RevertDuplicateGroupView(APIView):
    """Revert a resolved duplicate group (restore trashed photos, reset to pending)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={200: {"description": "Group reverted successfully"}},
    )
    def post(self, request, group_id):
        from api.models import Photo
        
        try:
            group = DuplicateGroup.objects.get(id=group_id, owner=request.user)
        except DuplicateGroup.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        if group.status != DuplicateGroup.Status.REVIEWED:
            return Response(
                {"error": "Can only revert reviewed groups"}, 
                status=status.HTTP_400_BAD_REQUEST
            )

        # Restore all trashed photos in this group
        restored_count = Photo.objects.filter(
            duplicate_group=group, 
            in_trashcan=True
        ).update(in_trashcan=False)

        # Reset group to pending
        group.status = DuplicateGroup.Status.PENDING
        group.preferred_photo = None
        group.save()

        logger.info(f"Reverted duplicate group {group.id}: restored {restored_count} photos")
        return Response({
            "status": "reverted", 
            "restored_count": restored_count
        })


class DeleteDuplicateGroupView(APIView):
    """Delete a duplicate group manually (unlinks photos but doesn't delete them)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        responses={200: {"description": "Group deleted successfully"}},
    )
    def delete(self, request, group_id):
        from api.models import Photo
        
        try:
            group = DuplicateGroup.objects.get(id=group_id, owner=request.user)
        except DuplicateGroup.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        # Unlink all photos from this group
        photo_count = Photo.objects.filter(duplicate_group=group).update(duplicate_group=None)
        
        # Delete the group
        group_id_deleted = group.id
        group.delete()

        logger.info(f"Deleted duplicate group {group_id_deleted}: unlinked {photo_count} photos")
        return Response({
            "status": "deleted", 
            "unlinked_count": photo_count
        })


class DetectDuplicatesView(APIView):
    """Trigger duplicate detection for the current user."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "sensitivity",
                str,
                description="Detection sensitivity: strict (threshold=5), normal (threshold=10), loose (threshold=15), or a custom number 1-20",
            ),
            OpenApiParameter(
                "clear_existing",
                bool,
                description="If true, clear existing pending duplicate groups before detection (allows re-running with different settings)",
            ),
        ],
        responses={202: {"description": "Duplicate detection started"}},
    )
    def post(self, request):
        # Parse sensitivity parameter
        sensitivity = request.data.get("sensitivity", request.query_params.get("sensitivity", "normal"))
        clear_existing = request.data.get("clear_existing", request.query_params.get("clear_existing", False))
        
        # Handle string "true"/"false" values
        if isinstance(clear_existing, str):
            clear_existing = clear_existing.lower() in ("true", "1", "yes")
        
        # Map sensitivity names to thresholds
        sensitivity_map = {
            "strict": 1,    # Nearly identical images only (exact duplicates)
            "normal": 3,    # Default - good balance of precision and recall  
            "loose": 5,    # More permissive - catches crops and edits
        }
        
        # Save settings to user profile
        request.user.duplicate_sensitivity = sensitivity if sensitivity in sensitivity_map else "normal"
        request.user.duplicate_clear_existing = clear_existing
        request.user.save(update_fields=["duplicate_sensitivity", "duplicate_clear_existing"])
        
        if sensitivity in sensitivity_map:
            threshold = sensitivity_map[sensitivity]
        else:
            try:
                threshold = max(1, min(20, int(sensitivity)))  # Clamp between 1-20
            except (ValueError, TypeError):
                threshold = DEFAULT_HAMMING_THRESHOLD
        
        # Queue the duplicate detection as a background job
        async_task(batch_detect_duplicates, request.user, threshold, clear_existing)
        logger.info(f"Duplicate detection queued for user {request.user.username} with threshold {threshold}, clear_existing={clear_existing}")
        return Response(
            {
                "status": "queued",
                "message": "Duplicate detection started",
                "threshold": threshold,
                "sensitivity": sensitivity if sensitivity in sensitivity_map else "custom",
                "clear_existing": clear_existing,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class DuplicateStatsView(APIView):
    """Get duplicate detection statistics for the current user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        from api.models import Photo

        total_groups = DuplicateGroup.objects.filter(owner=request.user).count()
        pending_groups = DuplicateGroup.objects.filter(
            owner=request.user, status=DuplicateGroup.Status.PENDING
        ).count()
        reviewed_groups = DuplicateGroup.objects.filter(
            owner=request.user, status=DuplicateGroup.Status.REVIEWED
        ).count()

        # Count photos in duplicate groups
        photos_in_groups = Photo.objects.filter(
            owner=request.user, duplicate_group__isnull=False
        ).count()

        # Count photos with perceptual hash
        photos_with_hash = Photo.objects.filter(
            owner=request.user, perceptual_hash__isnull=False
        ).count()

        total_photos = Photo.objects.filter(owner=request.user, hidden=False).count()

        return Response(
            {
                "total_groups": total_groups,
                "pending_groups": pending_groups,
                "reviewed_groups": reviewed_groups,
                "photos_in_groups": photos_in_groups,
                "photos_with_hash": photos_with_hash,
                "total_photos": total_photos,
                # Include saved detection settings
                "saved_sensitivity": request.user.duplicate_sensitivity,
                "saved_clear_existing": request.user.duplicate_clear_existing,
            }
        )
