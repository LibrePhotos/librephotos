"""
API views for PhotoStack management - organizational photo grouping.

Handles organizational stack types: RAW+JPEG pairs, burst sequences,
exposure brackets, live photos, and manual stacks.

NOTE: Duplicates (exact copies and visual duplicates) are now handled 
separately by the duplicates API in api/views/duplicates.py.
Stacks are for organization, duplicates are for storage cleanup.
"""

from django.core.paginator import Paginator
from django.db.models import Count
from django_q.tasks import async_task
from drf_spectacular.utils import OpenApiParameter, extend_schema
from rest_framework import status
from rest_framework.permissions import IsAuthenticated
from rest_framework.response import Response
from rest_framework.views import APIView

from api.models import Photo
from api.models.photo_stack import PhotoStack
from api.util import logger


class PhotoStackListView(APIView):
    """List all photo stacks for the current user with pagination and filters."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "stack_type",
                str,
                description="Filter by stack type: raw_jpeg, burst, bracket, live_photo, manual",
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
        stack_type_filter = request.query_params.get("stack_type", None)
        
        # Safely parse pagination parameters with defaults for invalid input
        try:
            page = max(1, int(request.query_params.get("page", 1)))
        except (ValueError, TypeError):
            page = 1
        
        try:
            page_size = max(1, min(int(request.query_params.get("page_size", 20)), 100))
        except (ValueError, TypeError):
            page_size = 20

        # Valid organizational stack types (exclude old duplicate types: visual_duplicate, exact_copy)
        valid_stack_types = [
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.BURST_SEQUENCE,
            PhotoStack.StackType.EXPOSURE_BRACKET,
            PhotoStack.StackType.LIVE_PHOTO,
            PhotoStack.StackType.MANUAL,
        ]

        stacks = PhotoStack.objects.filter(
            owner=request.user,
            stack_type__in=valid_stack_types
        ).prefetch_related(
            "photos__thumbnail", "primary_photo__thumbnail"
        ).annotate(
            photos_count=Count("photos")
        ).order_by("-created_at")

        if stack_type_filter:
            # Validate that the filter is a valid organizational stack type
            # valid_stack_types contains TextChoices values which are strings
            if stack_type_filter in [str(st) for st in valid_stack_types]:
                stacks = stacks.filter(stack_type=stack_type_filter)

        # Only return stacks with at least 2 photos
        stacks = stacks.filter(photos_count__gte=2)

        # Paginate results
        paginator = Paginator(stacks, page_size)
        page_obj = paginator.get_page(page)

        # Serialize manually to include nested photo data
        results = []
        for stack in page_obj.object_list:
            photos = stack.photos.all()[:4]  # Preview first 4 photos
            results.append({
                "id": str(stack.id),
                "stack_type": stack.stack_type,
                "stack_type_display": stack.get_stack_type_display(),
                "photo_count": stack.photos_count,
                "sequence_start": stack.sequence_start,
                "sequence_end": stack.sequence_end,
                "created_at": stack.created_at,
                "primary_photo": {
                    "image_hash": stack.primary_photo.image_hash,
                    "thumbnail_url": f"/media/square_thumbnails_small/{stack.primary_photo.image_hash}" if hasattr(stack.primary_photo, 'thumbnail') and stack.primary_photo.thumbnail.square_thumbnail_small else None,
                } if stack.primary_photo else None,
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


class PhotoStackDetailView(APIView):
    """Get details of a specific photo stack with all photos."""

    permission_classes = [IsAuthenticated]

    def get(self, request, stack_id):
        # Valid organizational stack types (exclude old duplicate types: visual_duplicate, exact_copy)
        valid_stack_types = [
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.BURST_SEQUENCE,
            PhotoStack.StackType.EXPOSURE_BRACKET,
            PhotoStack.StackType.LIVE_PHOTO,
            PhotoStack.StackType.MANUAL,
        ]
        
        try:
            stack = PhotoStack.objects.annotate(
                photos_count=Count("photos")
            ).get(id=stack_id, owner=request.user, stack_type__in=valid_stack_types)
        except PhotoStack.DoesNotExist:
            return Response(
                {"error": "Photo stack not found"}, status=status.HTTP_404_NOT_FOUND
            )

        photos = stack.photos.select_related('thumbnail', 'main_file', 'metadata').all()
        
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
                "is_primary": stack.primary_photo and p.image_hash == stack.primary_photo.image_hash,
                "file_path": p.main_file.path if p.main_file else None,
                "file_type": p.main_file.get_type_display() if p.main_file else None,
                "thumbnail_url": f"/media/square_thumbnails_small/{p.image_hash}" if hasattr(p, 'thumbnail') and p.thumbnail.square_thumbnail_small else None,
                "thumbnail_big_url": f"/media/thumbnails_big/{p.image_hash}" if hasattr(p, 'thumbnail') and p.thumbnail.thumbnail_big else None,
            }
            photo_data.append(data)

        return Response({
            "id": str(stack.id),
            "stack_type": stack.stack_type,
            "stack_type_display": stack.get_stack_type_display(),
            "photo_count": stack.photos_count,
            "sequence_start": stack.sequence_start,
            "sequence_end": stack.sequence_end,
            "created_at": stack.created_at,
            "updated_at": stack.updated_at,
            "primary_photo_hash": stack.primary_photo.image_hash if stack.primary_photo else None,
            "photos": photo_data,
        })


class PhotoStackDeleteView(APIView):
    """Delete a stack (unlinks photos but doesn't delete them)."""

    permission_classes = [IsAuthenticated]

    def delete(self, request, stack_id):
        try:
            stack = PhotoStack.objects.get(id=stack_id, owner=request.user)
        except PhotoStack.DoesNotExist:
            return Response(
                {"error": "Photo stack not found"}, status=status.HTTP_404_NOT_FOUND
            )

        # Unlink photos from this stack (ManyToMany)
        photo_count = stack.photos.count()
        for photo in stack.photos.all():
            photo.stacks.remove(stack)

        # Delete stack
        stack_id_str = str(stack.id)
        stack.delete()

        logger.info(f"Deleted stack {stack_id_str}: unlinked {photo_count} photos")
        return Response({
            "status": "deleted",
            "unlinked_count": photo_count
        })


class PhotoStackSetPrimaryView(APIView):
    """Set the primary (cover) photo for a stack."""

    permission_classes = [IsAuthenticated]

    def post(self, request, stack_id):
        try:
            stack = PhotoStack.objects.get(id=stack_id, owner=request.user)
        except PhotoStack.DoesNotExist:
            return Response(
                {"error": "Photo stack not found"}, status=status.HTTP_404_NOT_FOUND
            )

        photo_hash = request.data.get("photo_hash")
        if not photo_hash:
            return Response(
                {"error": "photo_hash is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        try:
            photo = stack.photos.get(image_hash=photo_hash)
        except Photo.DoesNotExist:
            return Response(
                {"error": "Photo not found in this stack"},
                status=status.HTTP_400_BAD_REQUEST
            )

        stack.primary_photo = photo
        stack.save(update_fields=['primary_photo', 'updated_at'])

        logger.info(f"Set primary photo for stack {stack.id} to {photo_hash}")
        return Response({
            "status": "updated",
            "primary_photo_hash": photo_hash
        })


class DetectStacksView(APIView):
    """Trigger stack detection for the current user (RAW+JPEG pairs, bursts, etc.).
    
    Burst detection uses the user's configured burst_detection_rules from their profile.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(
        parameters=[
            OpenApiParameter(
                "detect_raw_jpeg",
                bool,
                description="Detect RAW+JPEG pairs (default: true)",
            ),
            OpenApiParameter(
                "detect_bursts",
                bool,
                description="Detect burst sequences using user's configured rules (default: true)",
            ),
            OpenApiParameter(
                "detect_live_photos",
                bool,
                description="Detect live photos with embedded video (default: true)",
            ),
        ],
    )
    def post(self, request):
        from api.stack_detection import batch_detect_stacks
        
        # Burst detection now uses user's configured burst_detection_rules
        # burst_interval_ms and burst_use_visual_similarity are no longer passed here
        options = {
            'detect_raw_jpeg': request.data.get('detect_raw_jpeg', True),
            'detect_bursts': request.data.get('detect_bursts', True),
            'detect_live_photos': request.data.get('detect_live_photos', True),
        }

        # Queue background job
        async_task(batch_detect_stacks, request.user, options)
        
        logger.info(f"Stack detection queued for user {request.user.username} with options: {options}")
        return Response(
            {
                "status": "queued",
                "message": "Stack detection started",
                "options": options,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class PhotoStackStatsView(APIView):
    """Get stack statistics for the current user."""

    permission_classes = [IsAuthenticated]

    def get(self, request):
        # Valid organizational stack types (exclude old duplicate types: visual_duplicate, exact_copy)
        valid_stack_types = [
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.BURST_SEQUENCE,
            PhotoStack.StackType.EXPOSURE_BRACKET,
            PhotoStack.StackType.LIVE_PHOTO,
            PhotoStack.StackType.MANUAL,
        ]
        
        stacks = PhotoStack.objects.filter(
            owner=request.user,
            stack_type__in=valid_stack_types
        )
        
        # Count by type (only valid organizational types)
        by_type = {}
        for stack_type in valid_stack_types:
            by_type[stack_type] = stacks.filter(stack_type=stack_type).count()
        
        # Count photos in stacks (ManyToMany - photos with at least one valid organizational stack)
        photos_in_stacks = Photo.objects.filter(
            owner=request.user,
            stacks__stack_type__in=valid_stack_types
        ).distinct().count()
        
        total_photos = Photo.objects.filter(
            owner=request.user, hidden=False, in_trashcan=False
        ).count()

        return Response({
            "total_stacks": stacks.count(),
            "by_type": by_type,
            "photos_in_stacks": photos_in_stacks,
            "total_photos": total_photos,
        })


class CreateManualStackView(APIView):
    """Create a manual stack from selected photos."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        photo_hashes = request.data.get("photo_hashes", [])
        
        # De-duplicate the input to handle repeated hashes
        unique_hashes = list(dict.fromkeys(photo_hashes))  # Preserves order
        
        if len(unique_hashes) < 2:
            return Response(
                {"error": "At least 2 unique photos required to create a stack"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Verify all photos exist and belong to user
        photos = Photo.objects.filter(
            owner=request.user,
            image_hash__in=unique_hashes
        )
        
        if photos.count() != len(unique_hashes):
            return Response(
                {"error": "Some photos not found"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Check if any photo is already in a manual stack
        existing_stack = None
        for photo in photos:
            manual_stack = photo.stacks.filter(stack_type=PhotoStack.StackType.MANUAL).first()
            if manual_stack:
                existing_stack = manual_stack
                break
        
        if existing_stack:
            # Add to existing stack (ManyToMany)
            stack = existing_stack
            for photo in photos:
                if not photo.stacks.filter(pk=stack.pk).exists():
                    photo.stacks.add(stack)
        else:
            # Create new manual stack
            stack = PhotoStack.objects.create(
                owner=request.user,
                stack_type=PhotoStack.StackType.MANUAL,
            )
            for photo in photos:
                photo.stacks.add(stack)
        
        stack.auto_select_primary()
        
        logger.info(f"Created/updated MANUAL stack {stack.id} with {photos.count()} photos")
        return Response({
            "status": "created",
            "stack_id": str(stack.id),
            "photo_count": photos.count(),
        }, status=status.HTTP_201_CREATED)


class AddToStackView(APIView):
    """Add photos to an existing stack."""

    permission_classes = [IsAuthenticated]

    def post(self, request, stack_id):
        try:
            stack = PhotoStack.objects.get(id=stack_id, owner=request.user)
        except PhotoStack.DoesNotExist:
            return Response(
                {"error": "Photo stack not found"}, status=status.HTTP_404_NOT_FOUND
            )

        photo_hashes = request.data.get("photo_hashes", [])
        if not photo_hashes:
            return Response(
                {"error": "photo_hashes is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        photos = Photo.objects.filter(
            owner=request.user,
            image_hash__in=photo_hashes
        )
        
        added_count = 0
        for photo in photos:
            if not photo.stacks.filter(pk=stack.pk).exists():
                photo.stacks.add(stack)
                added_count += 1

        logger.info(f"Added {added_count} photos to stack {stack.id}")
        return Response({
            "status": "updated",
            "added_count": added_count,
            "total_count": stack.photos.count(),
        })


class RemoveFromStackView(APIView):
    """Remove photos from a stack."""

    permission_classes = [IsAuthenticated]

    def post(self, request, stack_id):
        try:
            stack = PhotoStack.objects.get(id=stack_id, owner=request.user)
        except PhotoStack.DoesNotExist:
            return Response(
                {"error": "Photo stack not found"}, status=status.HTTP_404_NOT_FOUND
            )

        photo_hashes = request.data.get("photo_hashes", [])
        if not photo_hashes:
            return Response(
                {"error": "photo_hashes is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        photos = Photo.objects.filter(
            owner=request.user,
            image_hash__in=photo_hashes
        )
        
        removed_count = 0
        for photo in photos:
            if photo.stacks.filter(pk=stack.pk).exists():
                photo.stacks.remove(stack)
                removed_count += 1

        # Delete stack if it now has fewer than 2 photos
        remaining_count = stack.photos.count()
        if remaining_count < 2:
            stack.delete()
            logger.info(f"Deleted stack {stack_id} after removing photos (only {remaining_count} left)")
            return Response({
                "status": "deleted",
                "removed_count": removed_count,
                "message": "Stack deleted because fewer than 2 photos remain",
            })

        # Update primary if it was removed
        if stack.primary_photo and stack.primary_photo.image_hash in photo_hashes:
            stack.auto_select_primary()

        logger.info(f"Removed {removed_count} photos from stack {stack.id}")
        return Response({
            "status": "updated",
            "removed_count": removed_count,
            "total_count": remaining_count,
        })


class MergeStacksView(APIView):
    """Merge all manual stacks containing any of the selected photos into one stack."""

    permission_classes = [IsAuthenticated]

    def post(self, request):
        photo_hashes = request.data.get("photo_hashes", [])
        
        if not photo_hashes:
            return Response(
                {"error": "photo_hashes is required"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # De-duplicate the input to handle repeated hashes
        unique_hashes = list(dict.fromkeys(photo_hashes))  # Preserves order

        # Verify all photos exist and belong to user
        photos = Photo.objects.filter(
            owner=request.user,
            image_hash__in=unique_hashes
        )
        
        if photos.count() != len(unique_hashes):
            return Response(
                {"error": "Some photos not found"},
                status=status.HTTP_400_BAD_REQUEST
            )

        # Find all manual stacks that contain any of the selected photos
        # Convert to list immediately to avoid multiple query evaluations with
        # potentially inconsistent ordering
        manual_stacks = list(PhotoStack.objects.filter(
            owner=request.user,
            stack_type=PhotoStack.StackType.MANUAL,
            photos__in=photos
        ).distinct())

        if not manual_stacks:
            return Response(
                {"error": "No manual stacks found containing selected photos"},
                status=status.HTTP_400_BAD_REQUEST
            )

        if len(manual_stacks) == 1:
            # Only one stack found, nothing to merge
            stack = manual_stacks[0]
            return Response({
                "status": "no_merge_needed",
                "stack_id": str(stack.id),
                "photo_count": stack.photos.count(),
                "message": "Only one stack found, nothing to merge",
            })

        # Merge all stacks into the first one
        target_stack = manual_stacks[0]
        stacks_to_merge = manual_stacks[1:]
        
        for stack in stacks_to_merge:
            target_stack.merge_with(stack)

        # Recalculate primary if needed
        if not target_stack.primary_photo:
            target_stack.auto_select_primary()

        logger.info(f"Merged {len(stacks_to_merge)} manual stacks into {target_stack.id}")
        return Response({
            "status": "merged",
            "stack_id": str(target_stack.id),
            "photo_count": target_stack.photos.count(),
            "merged_count": len(stacks_to_merge),
        }, status=status.HTTP_200_OK)
