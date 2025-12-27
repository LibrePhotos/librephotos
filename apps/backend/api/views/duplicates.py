"""
API views for Duplicate management - finding and cleaning up duplicate photos.

Handles duplicate types:
- EXACT_COPY: Byte-for-byte identical files (same MD5 hash, different paths)
- VISUAL_DUPLICATE: Visually similar photos (similar perceptual hash)

Duplicates are separate from Stacks because they have different purposes:
- Duplicates: Storage cleanup (review and delete redundant copies)
- Stacks: Photo organization (browse related photos like RAW+JPEG, bursts)
"""

from django.core.paginator import Paginator
from django.db.models import Count, Sum
from django_q.tasks import async_task
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import Photo
from api.models.duplicate import Duplicate
from api.util import logger


class DuplicateListView(APIView):
    """List all duplicate groups for the current user with pagination and filters."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "duplicate_type",
                str,
                description="Filter by duplicate type: exact_copy, visual_duplicate",
            ),
            OpenApiParameter(
                "status",
                str,
                description="Filter by review status: pending, resolved, dismissed",
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
    )
    def get(self, request):
        duplicate_type_filter = request.query_params.get("duplicate_type", None)
        status_filter = request.query_params.get("status", None)
        page = int(request.query_params.get("page", 1))
        page_size = min(int(request.query_params.get("page_size", 20)), 100)

        duplicates = Duplicate.objects.filter(owner=request.user).prefetch_related(
            "photos__thumbnail", "kept_photo__thumbnail"
        ).annotate(
            photos_count=Count("photos")
        ).order_by("-created_at")

        if duplicate_type_filter:
            duplicates = duplicates.filter(duplicate_type=duplicate_type_filter)
        
        if status_filter:
            duplicates = duplicates.filter(review_status=status_filter)

        # Only return duplicates with at least 2 photos
        duplicates = duplicates.filter(photos_count__gte=2)

        # Paginate results
        paginator = Paginator(duplicates, page_size)
        page_obj = paginator.get_page(page)

        # Serialize manually to include nested photo data
        results = []
        for duplicate in page_obj.object_list:
            photos = duplicate.photos.all()[:4]  # Preview first 4 photos
            results.append({
                "id": str(duplicate.id),
                "duplicate_type": duplicate.duplicate_type,
                "duplicate_type_display": duplicate.get_duplicate_type_display(),
                "review_status": duplicate.review_status,
                "review_status_display": duplicate.get_review_status_display(),
                "photo_count": duplicate.photos_count,
                "potential_savings": duplicate.potential_savings,
                "similarity_score": duplicate.similarity_score,
                "created_at": duplicate.created_at,
                "kept_photo": {
                    "image_hash": duplicate.kept_photo.image_hash,
                    "thumbnail_url": f"/media/square_thumbnails_small/{duplicate.kept_photo.image_hash}" if hasattr(duplicate.kept_photo, 'thumbnail') and duplicate.kept_photo.thumbnail.square_thumbnail_small else None,
                } if duplicate.kept_photo else None,
                "preview_photos": [
                    {
                        "image_hash": p.image_hash,
                        "thumbnail_url": f"/media/square_thumbnails_small/{p.image_hash}" if hasattr(p, 'thumbnail') and p.thumbnail.square_thumbnail_small else None,
                    }
                    for p in photos
                ],
            })

        return Response({
            "results": results,
            "count": paginator.count,
            "num_pages": paginator.num_pages,
            "page": page,
            "page_size": page_size,
            "has_next": page_obj.has_next(),
            "has_previous": page_obj.has_previous(),
        })


class DuplicateDetailView(APIView):
    """Get details of a specific duplicate group with all photos."""

    permission_classes = [IsAuthenticated]

    def get(self, request, duplicate_id):
        try:
            duplicate = Duplicate.objects.annotate(
                photos_count=Count("photos")
            ).get(id=duplicate_id, owner=request.user)
        except Duplicate.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        photos = duplicate.photos.select_related('thumbnail', 'main_file', 'metadata').all()
        
        photo_data = []
        for p in photos:
            # Width, height, and camera are on the metadata model
            width = None
            height = None
            camera = None
            if hasattr(p, 'metadata') and p.metadata:
                width = p.metadata.width
                height = p.metadata.height
                camera = p.metadata.camera_model
            
            data = {
                "id": str(p.id),
                "image_hash": p.image_hash,
                "width": width,
                "height": height,
                "size": p.size,
                "camera": camera,
                "exif_timestamp": p.exif_timestamp,
                "is_kept": duplicate.kept_photo and p.image_hash == duplicate.kept_photo.image_hash,
                "file_path": p.main_file.path if p.main_file else None,
                "file_type": p.main_file.get_type_display() if p.main_file else None,
                "thumbnail_url": f"/media/square_thumbnails_small/{p.image_hash}" if hasattr(p, 'thumbnail') and p.thumbnail.square_thumbnail_small else None,
                "thumbnail_big_url": f"/media/thumbnails_big/{p.image_hash}" if hasattr(p, 'thumbnail') and p.thumbnail.thumbnail_big else None,
            }
            photo_data.append(data)

        # Get suggested best photo
        suggested_photo = duplicate.auto_select_best_photo()

        return Response({
            "id": str(duplicate.id),
            "duplicate_type": duplicate.duplicate_type,
            "duplicate_type_display": duplicate.get_duplicate_type_display(),
            "review_status": duplicate.review_status,
            "review_status_display": duplicate.get_review_status_display(),
            "photo_count": duplicate.photos_count,
            "potential_savings": duplicate.potential_savings,
            "similarity_score": duplicate.similarity_score,
            "created_at": duplicate.created_at,
            "updated_at": duplicate.updated_at,
            "kept_photo_hash": duplicate.kept_photo.image_hash if duplicate.kept_photo else None,
            "suggested_photo_hash": suggested_photo.image_hash if suggested_photo else None,
            "photos": photo_data,
        })


class DuplicateResolveView(APIView):
    """Resolve a duplicate group by selecting a photo to keep and optionally trashing others."""

    permission_classes = [IsAuthenticated]

    def post(self, request, duplicate_id):
        try:
            duplicate = Duplicate.objects.get(id=duplicate_id, owner=request.user)
        except Duplicate.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        keep_photo_hash = request.data.get("keep_photo_hash")
        trash_others = request.data.get("trash_others", True)

        if not keep_photo_hash:
            return Response(
                {"error": "keep_photo_hash is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Verify photo exists in duplicate group
        try:
            keep_photo = duplicate.photos.get(image_hash=keep_photo_hash)
        except Photo.DoesNotExist:
            return Response(
                {"error": "Photo not found in this duplicate group"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Resolve the duplicate
        duplicate.resolve(keep_photo, trash_others)

        logger.info(f"Resolved duplicate {duplicate.id}: kept {keep_photo_hash}, trashed {duplicate.trashed_count}")
        return Response({
            "status": "resolved",
            "kept_photo": keep_photo_hash,
            "trashed_count": duplicate.trashed_count,
        })


class DuplicateDismissView(APIView):
    """Dismiss a duplicate group (mark photos as not actually duplicates)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, duplicate_id):
        try:
            duplicate = Duplicate.objects.get(id=duplicate_id, owner=request.user)
        except Duplicate.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        duplicate.dismiss()

        logger.info(f"Dismissed duplicate {duplicate.id}")
        return Response({"status": "dismissed"})


class DuplicateRevertView(APIView):
    """Revert a resolved duplicate (restore trashed photos, reset to pending)."""

    permission_classes = [IsAuthenticated]

    def post(self, request, duplicate_id):
        try:
            duplicate = Duplicate.objects.get(id=duplicate_id, owner=request.user)
        except Duplicate.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        if duplicate.review_status != Duplicate.ReviewStatus.RESOLVED:
            return Response(
                {"error": "Can only revert resolved duplicates"},
                status=status.HTTP_400_BAD_REQUEST
            )

        restored_count = duplicate.revert()

        logger.info(f"Reverted duplicate {duplicate.id}: restored {restored_count} photos")
        return Response({
            "status": "reverted",
            "restored_count": restored_count
        })


class DuplicateDeleteView(APIView):
    """Delete a duplicate group (unlinks photos but doesn't delete them)."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, duplicate_id):
        try:
            duplicate = Duplicate.objects.get(id=duplicate_id, owner=request.user)
        except Duplicate.DoesNotExist:
            return Response(
                {"error": "Duplicate group not found"}, status=status.HTTP_404_NOT_FOUND
            )

        # Unlink photos from this duplicate group (ManyToMany)
        photo_count = duplicate.photos.count()
        for photo in duplicate.photos.all():
            photo.duplicates.remove(duplicate)

        # Delete duplicate group
        duplicate_id_str = str(duplicate.id)
        duplicate.delete()

        logger.info(f"Deleted duplicate group {duplicate_id_str}: unlinked {photo_count} photos")
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
                "detect_exact_copies",
                bool,
                description="Detect exact file copies (default: true)",
            ),
            OpenApiParameter(
                "detect_visual_duplicates",
                bool,
                description="Detect visually similar photos (default: true)",
            ),
            OpenApiParameter(
                "visual_threshold",
                int,
                description="Hamming distance threshold for visual duplicates (default: 10)",
            ),
            OpenApiParameter(
                "clear_pending",
                bool,
                description="Clear existing pending duplicates before detection (default: false)",
            ),
        ],
    )
    def post(self, request):
        from api.duplicate_detection import batch_detect_duplicates
        
        options = {
            'detect_exact_copies': request.data.get('detect_exact_copies', True),
            'detect_visual_duplicates': request.data.get('detect_visual_duplicates', True),
            'visual_threshold': int(request.data.get('visual_threshold', 10)),
            'clear_pending': request.data.get('clear_pending', False),
        }

        # Queue background job
        async_task(batch_detect_duplicates, request.user, options)
        
        logger.info(f"Duplicate detection queued for user {request.user.username} with options: {options}")
        return Response(
            {
                "status": "queued",
                "message": "Duplicate detection started",
                "options": options,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class DuplicateStatsView(APIView):
    """Get duplicate statistics for the current user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        duplicates = Duplicate.objects.filter(owner=request.user)
        
        # Count by type
        by_type = {}
        for dup_type in Duplicate.DuplicateType.values:
            by_type[dup_type] = duplicates.filter(duplicate_type=dup_type).count()
        
        # Count by review status
        pending_count = duplicates.filter(review_status=Duplicate.ReviewStatus.PENDING).count()
        resolved_count = duplicates.filter(review_status=Duplicate.ReviewStatus.RESOLVED).count()
        dismissed_count = duplicates.filter(review_status=Duplicate.ReviewStatus.DISMISSED).count()
        
        # Calculate potential savings (from pending duplicates)
        total_savings = duplicates.filter(
            review_status=Duplicate.ReviewStatus.PENDING
        ).aggregate(total=Sum('potential_savings'))['total'] or 0
        
        # Count photos in duplicate groups
        photos_in_duplicates = Photo.objects.filter(
            owner=request.user, duplicates__isnull=False
        ).distinct().count()
        
        total_photos = Photo.objects.filter(
            owner=request.user, hidden=False, in_trashcan=False
        ).count()

        return Response({
            "total_duplicates": duplicates.count(),
            "pending_duplicates": pending_count,
            "resolved_duplicates": resolved_count,
            "dismissed_duplicates": dismissed_count,
            "by_type": by_type,
            "photos_in_duplicates": photos_in_duplicates,
            "total_photos": total_photos,
            "potential_savings_bytes": total_savings,
            "potential_savings_mb": round(total_savings / (1024 * 1024), 2) if total_savings else 0,
        })
