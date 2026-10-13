"""
API views for PhotoStack management - organizational photo grouping.

Handles organizational stack types: burst sequences, exposure brackets,
and manual stacks.

NOTE: RAW+JPEG pairs and Live Photos are NO LONGER stacks. They use
the Photo.files field for file variants (PhotoPrism-like model).

NOTE: Duplicates (exact copies and visual duplicates) are handled
separately by the duplicates API in api/views/duplicates.py.
Stacks are for organization, duplicates are for storage cleanup.
"""

import logging
from collections import Counter

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Count
from drf_spectacular.utils import extend_schema
from rest_framework import status
from rest_framework.exceptions import NotFound, ValidationError
from rest_framework.permissions import IsAuthenticated
from rest_framework.request import Request
from rest_framework.response import Response
from rest_framework.views import APIView

from api.drf.pagination import (
    PAGE_PARAMETERS,
    PaginatedViewMixin,
    with_legacy_page_flags,
)
from api.drf.params import parse_body, parse_query
from api.drf.request_user import request_user
from api.jobs.queue import JobStep
from api.jobs.start import enqueue_for_request
from api.models import LongRunningJob, Photo, PhotoMetadata
from api.models.photo_stack import PhotoStack
from api.serializers.stack import (
    CreateManualStackRequest,
    DetectStacksRequest,
    PhotoStackListQuery,
    PhotoStackSetPrimaryRequest,
    StackPhotosRequest,
)

logger = logging.getLogger(__name__)


def _metadata_or_none(photo: Photo) -> PhotoMetadata | None:
    """The photo's metadata row, or None when it has none (reverse one-to-one)."""
    try:
        return photo.metadata
    except ObjectDoesNotExist:
        return None


class PhotoStackListView(PaginatedViewMixin, APIView):
    """List all photo stacks for the current user with pagination and filters."""

    permission_classes = [IsAuthenticated]

    # An APIView's GET is "retrieve" to drf-spectacular, the same operationId
    # as the detail view's; named so the schema does not number them.
    @extend_schema(
        operation_id="api_stacks_list",
        parameters=[PhotoStackListQuery, *PAGE_PARAMETERS],
    )
    def get(self, request: Request) -> Response:
        user = request_user(request)
        params = parse_query(request, PhotoStackListQuery)
        stack_type_filter = params.get("stack_type")

        # Use model-defined valid stack types (excludes deprecated RAW_JPEG_PAIR, LIVE_PHOTO)
        valid_stack_types = PhotoStack.VALID_STACK_TYPES

        stacks = (
            PhotoStack.objects.owned_by(user)
            .filter(stack_type__in=valid_stack_types)
            .prefetch_related("photos__thumbnail", "primary_photo__thumbnail")
            .annotate(photos_count=Count("photos"))
            .order_by("-created_at")
        )

        if stack_type_filter:
            # Validate that the filter is a valid organizational stack type
            # valid_stack_types contains TextChoices values which are strings
            if stack_type_filter in [str(st) for st in valid_stack_types]:
                stacks = stacks.filter(stack_type=stack_type_filter)

        # Only return stacks with at least 2 photos
        stacks = stacks.filter(photos_count__gte=2)

        # Serialize manually to include nested photo data
        results: list[dict[str, object]] = []
        for stack in self.paginate_queryset(stacks):
            photos = stack.photos.all()[:4]  # Preview first 4 photos
            # photos_count is the Count() annotated in the queryset above; the
            # type checker does not see annotated attributes.
            photos_count: int = getattr(stack, "photos_count")
            results.append(
                {
                    "id": str(stack.id),
                    "stack_type": stack.stack_type,
                    "stack_type_display": stack.get_stack_type_display(),
                    "photo_count": photos_count,
                    "sequence_start": stack.sequence_start,
                    "sequence_end": stack.sequence_end,
                    "created_at": stack.created_at,
                    "primary_photo": {
                        "image_hash": stack.primary_photo.image_hash,
                        "thumbnail_url": f"/media/square_thumbnails_small/{stack.primary_photo.image_hash}"
                        if hasattr(stack.primary_photo, "thumbnail")
                        and stack.primary_photo.thumbnail.square_thumbnail_small
                        else None,
                    }
                    if stack.primary_photo
                    else None,
                    "preview_photos": [
                        {
                            "image_hash": p.image_hash,
                            "thumbnail_url": f"/media/square_thumbnails_small/{p.image_hash}"
                            if hasattr(p, "thumbnail")
                            and p.thumbnail.square_thumbnail_small
                            else None,
                        }
                        for p in photos
                    ],
                }
            )

        return with_legacy_page_flags(self.get_paginated_response(results))


class PhotoStackDetailView(APIView):
    """Get details of a specific photo stack with all photos."""

    permission_classes = [IsAuthenticated]

    def get(self, request: Request, stack_id: str) -> Response:
        user = request_user(request)
        # Use model-defined valid stack types (excludes deprecated RAW_JPEG_PAIR, LIVE_PHOTO)
        # Also include deprecated types for viewing existing stacks during migration
        all_stack_types = PhotoStack.VALID_STACK_TYPES + [
            PhotoStack.StackType.RAW_JPEG_PAIR,
            PhotoStack.StackType.LIVE_PHOTO,
        ]

        try:
            stack = (
                PhotoStack.objects.owned_by(user)
                .annotate(photos_count=Count("photos"))
                .get(id=stack_id, stack_type__in=all_stack_types)
            )
        except PhotoStack.DoesNotExist:
            raise NotFound("Photo stack not found")

        photos = (
            stack.photos.select_related("thumbnail", "main_file", "metadata")
            .prefetch_related("files")
            .all()
        )

        photo_data = []
        for p in photos:
            # Width, height, and camera are on the metadata model
            width = None
            height = None
            camera = None
            metadata = _metadata_or_none(p)
            if metadata is not None:
                width = metadata.width
                height = metadata.height
                camera = metadata.camera_model

            # Get all file variants for this photo
            file_variants = []
            for f in p.files.all():
                file_variants.append(
                    {
                        "hash": f.hash,
                        "path": f.path,
                        "type": f.get_type_display().lower(),
                        "is_main": p.main_file and f.hash == p.main_file.hash,
                        "filename": f.path.split("/")[-1] if f.path else None,
                    }
                )

            data = {
                "id": str(p.id),
                "image_hash": p.image_hash,
                "width": width,
                "height": height,
                "size": p.size,
                "camera": camera,
                "exif_timestamp": p.exif_timestamp,
                "is_primary": stack.primary_photo
                and p.image_hash == stack.primary_photo.image_hash,
                "file_path": p.main_file.path if p.main_file else None,
                "file_type": p.main_file.get_type_display().lower()
                if p.main_file
                else None,
                "file_variants": file_variants if file_variants else None,
                "thumbnail_url": f"/media/square_thumbnails_small/{p.image_hash}"
                if hasattr(p, "thumbnail") and p.thumbnail.square_thumbnail_small
                else None,
                "thumbnail_big_url": f"/media/thumbnails_big/{p.image_hash}"
                if hasattr(p, "thumbnail") and p.thumbnail.thumbnail_big
                else None,
            }
            photo_data.append(data)

        return Response(
            {
                "id": str(stack.id),
                "stack_type": stack.stack_type,
                "stack_type_display": stack.get_stack_type_display(),
                "photo_count": getattr(stack, "photos_count"),
                "sequence_start": stack.sequence_start,
                "sequence_end": stack.sequence_end,
                "created_at": stack.created_at,
                "updated_at": stack.updated_at,
                "primary_photo_hash": stack.primary_photo.image_hash
                if stack.primary_photo
                else None,
                "photos": photo_data,
            }
        )

    def delete(self, request: Request, stack_id: str) -> Response:
        """Delete a stack (unlinks photos but doesn't delete them)."""
        user = request_user(request)
        try:
            stack = PhotoStack.objects.get_owned(user, id=stack_id)
        except PhotoStack.DoesNotExist:
            raise NotFound("Photo stack not found")

        # Unlink photos from this stack (ManyToMany)
        photo_count = stack.photos.count()
        for photo in stack.photos.all():
            photo.stacks.remove(stack)

        # Delete stack
        stack_id_str = str(stack.id)
        stack.delete()

        logger.info("Deleted stack %s: unlinked %s photos", stack_id_str, photo_count)
        return Response({"status": "deleted", "unlinked_count": photo_count})


class PhotoStackDeleteView(APIView):
    """Delete a stack (unlinks photos but doesn't delete them)."""

    permission_classes = [IsAuthenticated]

    def delete(self, request: Request, stack_id: str) -> Response:
        user = request_user(request)
        try:
            stack = PhotoStack.objects.get_owned(user, id=stack_id)
        except PhotoStack.DoesNotExist:
            raise NotFound("Photo stack not found")

        # Unlink photos from this stack (ManyToMany)
        photo_count = stack.photos.count()
        for photo in stack.photos.all():
            photo.stacks.remove(stack)

        # Delete stack
        stack_id_str = str(stack.id)
        stack.delete()

        logger.info("Deleted stack %s: unlinked %s photos", stack_id_str, photo_count)
        return Response({"status": "deleted", "unlinked_count": photo_count})


class PhotoStackSetPrimaryView(APIView):
    """Set the primary (cover) photo for a stack."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=PhotoStackSetPrimaryRequest)
    def post(self, request: Request, stack_id: str) -> Response:
        user = request_user(request)
        try:
            stack = PhotoStack.objects.get_owned(user, id=stack_id)
        except PhotoStack.DoesNotExist:
            raise NotFound("Photo stack not found")

        photo_hash = parse_body(request, PhotoStackSetPrimaryRequest)["photo_hash"]

        try:
            photo = stack.photos.get(image_hash=photo_hash)
        except Photo.DoesNotExist:
            raise ValidationError("Photo not found in this stack")

        stack.primary_photo = photo
        stack.save(update_fields=["primary_photo", "updated_at"])

        logger.info("Set primary photo for stack %s to %s", stack.id, photo_hash)
        return Response({"status": "updated", "primary_photo_hash": photo_hash})


class DetectStacksView(APIView):
    """Trigger stack detection for the current user (bursts, brackets).

    NOTE: RAW+JPEG pairs and Live Photos are now handled as file variants
    during scan (PhotoPrism-like model), not as stacks.

    Burst detection uses the user's configured burst_detection_rules from their profile.
    """

    permission_classes = [IsAuthenticated]

    @extend_schema(request=DetectStacksRequest)
    def post(self, request: Request) -> Response:
        from api.stacks.detection import batch_detect_stacks

        user = request_user(request)
        # RAW+JPEG and Live Photos are now file variants, not stacks
        # Only burst/bracket detection is done here
        options = parse_body(request, DetectStacksRequest)

        [job] = enqueue_for_request(
            user,
            [
                JobStep(
                    LongRunningJob.JOB_DETECT_STACKS,
                    batch_detect_stacks,
                    (user, options),
                )
            ],
            "stack detection",
        )

        logger.info(
            "Stack detection queued for user %s with options: %s",
            user.username,
            options,
        )
        return Response(
            {
                "status": "queued",
                "message": "Stack detection started",
                "options": options,
                "job_id": job.job_id,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class PhotoStackStatsView(APIView):
    """Get stack statistics for the current user.

    ``total_stacks``, ``photos_in_stacks`` and the ``by_type`` counts of the
    organizational types count what PhotoStackListView lists: those types,
    with at least 2 photos. Counting more put a number on the Stacks badge
    that the list could not show. The deprecated RAW+JPEG and Live Photo types
    stay in ``by_type`` so their migration can be followed, but nothing else
    counts them.
    """

    permission_classes = [IsAuthenticated]

    DEPRECATED_STACK_TYPES = [
        PhotoStack.StackType.RAW_JPEG_PAIR,
        PhotoStack.StackType.LIVE_PHOTO,
    ]

    def get(self, request: Request) -> Response:
        user = request_user(request)
        listed = (
            PhotoStack.objects.owned_by(user)
            .filter(stack_type__in=PhotoStack.VALID_STACK_TYPES)
            .annotate(photos_count=Count("photos"))
            .filter(photos_count__gte=2)
        )

        listed_types = Counter(listed.values_list("stack_type", flat=True))
        by_type = {
            stack_type: listed_types[stack_type]
            for stack_type in PhotoStack.VALID_STACK_TYPES
        }
        deprecated = PhotoStack.objects.owned_by(user).filter(
            stack_type__in=self.DEPRECATED_STACK_TYPES
        )
        for stack_type in self.DEPRECATED_STACK_TYPES:
            by_type[stack_type] = deprecated.filter(stack_type=stack_type).count()

        # A photo can be in several stacks (ManyToMany): count it once.
        photos_in_stacks = (
            Photo.objects.owned_by(user)
            .filter(stacks__in=listed.values("pk"))
            .distinct()
            .count()
        )

        total_photos = (
            Photo.objects.owned_by(user).filter(hidden=False, in_trashcan=False).count()
        )

        return Response(
            {
                "total_stacks": listed_types.total(),
                "by_type": by_type,
                "photos_in_stacks": photos_in_stacks,
                "total_photos": total_photos,
            }
        )


class CreateManualStackView(APIView):
    """Create a manual stack from selected photos."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=CreateManualStackRequest)
    def post(self, request: Request) -> Response:
        user = request_user(request)
        photo_hashes = parse_body(request, CreateManualStackRequest)["photo_hashes"]

        # De-duplicate the input to handle repeated hashes
        unique_hashes = list(dict.fromkeys(photo_hashes))  # Preserves order

        if len(unique_hashes) < 2:
            raise ValidationError("At least 2 unique photos required to create a stack")

        # Verify all photos exist and belong to user
        photos = Photo.objects.owned_by(user).filter(image_hash__in=unique_hashes)

        if photos.count() != len(unique_hashes):
            raise ValidationError("Some photos not found")

        # Check if any photo is already in a manual stack
        existing_stack: PhotoStack | None = None
        for photo in photos:
            manual_stack = photo.stacks.filter(
                stack_type=PhotoStack.StackType.MANUAL
            ).first()
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
                owner=user,
                stack_type=PhotoStack.StackType.MANUAL,
            )
            for photo in photos:
                photo.stacks.add(stack)

        stack.auto_select_primary()

        logger.info(
            "Created/updated MANUAL stack %s with %s photos", stack.id, photos.count()
        )
        return Response(
            {
                "status": "created",
                "stack_id": str(stack.id),
                "photo_count": photos.count(),
            },
            status=status.HTTP_201_CREATED,
        )


class AddToStackView(APIView):
    """Add photos to an existing stack."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=StackPhotosRequest)
    def post(self, request: Request, stack_id: str) -> Response:
        user = request_user(request)
        try:
            stack = PhotoStack.objects.get_owned(user, id=stack_id)
        except PhotoStack.DoesNotExist:
            raise NotFound("Photo stack not found")

        photo_hashes = parse_body(request, StackPhotosRequest)["photo_hashes"]

        photos = Photo.objects.owned_by(user).filter(image_hash__in=photo_hashes)

        added_count = 0
        for photo in photos:
            if not photo.stacks.filter(pk=stack.pk).exists():
                photo.stacks.add(stack)
                added_count += 1

        logger.info("Added %s photos to stack %s", added_count, stack.id)
        return Response(
            {
                "status": "updated",
                "added_count": added_count,
                "total_count": stack.photos.count(),
            }
        )


class RemoveFromStackView(APIView):
    """Remove photos from a stack."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=StackPhotosRequest)
    def post(self, request: Request, stack_id: str) -> Response:
        user = request_user(request)
        try:
            stack = PhotoStack.objects.get_owned(user, id=stack_id)
        except PhotoStack.DoesNotExist:
            raise NotFound("Photo stack not found")

        photo_hashes = parse_body(request, StackPhotosRequest)["photo_hashes"]

        photos = Photo.objects.owned_by(user).filter(image_hash__in=photo_hashes)

        removed_count = 0
        for photo in photos:
            if photo.stacks.filter(pk=stack.pk).exists():
                photo.stacks.remove(stack)
                removed_count += 1

        # Delete stack if it now has fewer than 2 photos
        remaining_count = stack.photos.count()
        if remaining_count < 2:
            stack.delete()
            logger.info(
                "Deleted stack %s after removing photos (only %s left)",
                stack_id,
                remaining_count,
            )
            return Response(
                {
                    "status": "deleted",
                    "removed_count": removed_count,
                    "message": "Stack deleted because fewer than 2 photos remain",
                }
            )

        # Update primary if it was removed
        if stack.primary_photo and stack.primary_photo.image_hash in photo_hashes:
            stack.auto_select_primary()

        logger.info("Removed %s photos from stack %s", removed_count, stack.id)
        return Response(
            {
                "status": "updated",
                "removed_count": removed_count,
                "total_count": remaining_count,
            }
        )


class MergeStacksView(APIView):
    """Merge all manual stacks containing any of the selected photos into one stack."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=StackPhotosRequest)
    def post(self, request: Request) -> Response:
        user = request_user(request)
        photo_hashes = parse_body(request, StackPhotosRequest)["photo_hashes"]

        # De-duplicate the input to handle repeated hashes
        unique_hashes = list(dict.fromkeys(photo_hashes))  # Preserves order

        # Verify all photos exist and belong to user
        photos = Photo.objects.owned_by(user).filter(image_hash__in=unique_hashes)

        if photos.count() != len(unique_hashes):
            raise ValidationError("Some photos not found")

        # Find all manual stacks that contain any of the selected photos
        # Convert to list immediately to avoid multiple query evaluations with
        # potentially inconsistent ordering
        manual_stacks = list(
            PhotoStack.objects.owned_by(user)
            .filter(
                stack_type=PhotoStack.StackType.MANUAL,
                photos__in=photos,
            )
            .distinct()
        )

        if not manual_stacks:
            raise ValidationError("No manual stacks found containing selected photos")

        if len(manual_stacks) == 1:
            # Only one stack found, nothing to merge
            stack = manual_stacks[0]
            return Response(
                {
                    "status": "no_merge_needed",
                    "stack_id": str(stack.id),
                    "photo_count": stack.photos.count(),
                    "message": "Only one stack found, nothing to merge",
                }
            )

        # Merge all stacks into the first one
        target_stack = manual_stacks[0]
        stacks_to_merge = manual_stacks[1:]

        for stack in stacks_to_merge:
            target_stack.merge_with(stack)

        # Recalculate primary if needed
        if not target_stack.primary_photo:
            target_stack.auto_select_primary()

        logger.info(
            "Merged %s manual stacks into %s", len(stacks_to_merge), target_stack.id
        )
        return Response(
            {
                "status": "merged",
                "stack_id": str(target_stack.id),
                "photo_count": target_stack.photos.count(),
                "merged_count": len(stacks_to_merge),
            },
            status=status.HTTP_200_OK,
        )
