"""
API views for Duplicate management - finding and cleaning up duplicate photos.

Handles duplicate types:
- EXACT_COPY: Byte-for-byte identical files (same MD5 hash, different paths)
- VISUAL_DUPLICATE: Visually similar photos (similar perceptual hash)

Duplicates are separate from Stacks because they have different purposes:
- Duplicates: Storage cleanup (review and delete redundant copies)
- Stacks: Photo organization (browse related photos like RAW+JPEG, bursts)
"""

import logging

from django.core.exceptions import ObjectDoesNotExist
from django.db.models import Count, Sum
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
from api.models.duplicate import Duplicate
from api.serializers.duplicate import (
    DetectDuplicatesQueuedSerializer,
    DetectDuplicatesRequest,
    DismissDuplicateResponseSerializer,
    DuplicateDetailSerializer,
    DuplicateListQuery,
    DuplicatePageSerializer,
    DuplicateResolveRequest,
    DuplicateStatsSerializer,
    ResolveDuplicateResponseSerializer,
    RevertDuplicateResponseSerializer,
)
from api.serializers.photo_groups import UnlinkGroupResponseSerializer

logger = logging.getLogger(__name__)


def _metadata_or_none(photo: Photo) -> PhotoMetadata | None:
    """The photo's metadata row, or None when it has none (reverse one-to-one)."""
    try:
        return photo.metadata
    except ObjectDoesNotExist:
        return None


class DuplicateListView(PaginatedViewMixin, APIView):
    """List all duplicate groups for the current user with pagination and filters."""

    permission_classes = [IsAuthenticated]

    # An APIView's GET is "retrieve" to drf-spectacular, the same operationId
    # as the detail view's; named so the schema does not number them.
    @extend_schema(
        operation_id="api_duplicates_list",
        parameters=[DuplicateListQuery, *PAGE_PARAMETERS],
        responses=DuplicatePageSerializer,
    )
    def get(self, request: Request) -> Response:
        user = request_user(request)
        params = parse_query(request, DuplicateListQuery)
        duplicate_type_filter = params.get("duplicate_type")
        status_filter = params.get("status")

        duplicates = (
            Duplicate.objects.owned_by(user)
            .prefetch_related("photos__thumbnail", "kept_photo__thumbnail")
            .annotate(photos_count=Count("photos"))
            .order_by("-created_at")
        )

        if duplicate_type_filter:
            duplicates = duplicates.filter(duplicate_type=duplicate_type_filter)

        if status_filter:
            duplicates = duplicates.filter(review_status=status_filter)

        # Only return duplicates with at least 2 photos
        duplicates = duplicates.filter(photos_count__gte=2)

        # Serialize manually to include nested photo data
        results: list[dict[str, object]] = []
        for duplicate in self.paginate_queryset(duplicates):
            photos = duplicate.photos.all()[:4]  # Preview first 4 photos
            # photos_count is the Count() annotated in the queryset above; the
            # type checker does not see annotated attributes.
            photos_count: int = getattr(duplicate, "photos_count")
            results.append(
                {
                    "id": str(duplicate.id),
                    "duplicate_type": duplicate.duplicate_type,
                    "duplicate_type_display": duplicate.get_duplicate_type_display(),
                    "review_status": duplicate.review_status,
                    "review_status_display": duplicate.get_review_status_display(),
                    "photo_count": photos_count,
                    "potential_savings": duplicate.potential_savings,
                    "similarity_score": duplicate.similarity_score,
                    "created_at": duplicate.created_at,
                    "kept_photo": {
                        "image_hash": duplicate.kept_photo.image_hash,
                        "thumbnail_url": f"/media/square_thumbnails_small/{duplicate.kept_photo.image_hash}"
                        if hasattr(duplicate.kept_photo, "thumbnail")
                        and duplicate.kept_photo.thumbnail.square_thumbnail_small
                        else None,
                    }
                    if duplicate.kept_photo
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


class DuplicateDetailView(APIView):
    """Get details of a specific duplicate group with all photos."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=DuplicateDetailSerializer)
    def get(self, request: Request, duplicate_id: str) -> Response:
        user = request_user(request)
        try:
            duplicate = (
                Duplicate.objects.owned_by(user)
                .annotate(photos_count=Count("photos"))
                .get(id=duplicate_id)
            )
        except Duplicate.DoesNotExist:
            raise NotFound("Duplicate group not found")

        photos = duplicate.photos.select_related(
            "thumbnail", "main_file", "metadata"
        ).all()

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

            data = {
                "id": str(p.id),
                "image_hash": p.image_hash,
                "width": width,
                "height": height,
                "size": p.size,
                "camera": camera,
                "exif_timestamp": p.exif_timestamp,
                "is_kept": duplicate.kept_photo
                and p.image_hash == duplicate.kept_photo.image_hash,
                "file_path": p.main_file.path if p.main_file else None,
                "file_type": p.main_file.get_type_display() if p.main_file else None,
                "thumbnail_url": f"/media/square_thumbnails_small/{p.image_hash}"
                if hasattr(p, "thumbnail") and p.thumbnail.square_thumbnail_small
                else None,
                "thumbnail_big_url": f"/media/thumbnails_big/{p.image_hash}"
                if hasattr(p, "thumbnail") and p.thumbnail.thumbnail_big
                else None,
            }
            photo_data.append(data)

        # Get suggested best photo
        suggested_photo = duplicate.auto_select_best_photo()

        return Response(
            {
                "id": str(duplicate.id),
                "duplicate_type": duplicate.duplicate_type,
                "duplicate_type_display": duplicate.get_duplicate_type_display(),
                "review_status": duplicate.review_status,
                "review_status_display": duplicate.get_review_status_display(),
                "photo_count": getattr(duplicate, "photos_count"),
                "potential_savings": duplicate.potential_savings,
                "similarity_score": duplicate.similarity_score,
                "created_at": duplicate.created_at,
                "updated_at": duplicate.updated_at,
                "kept_photo_hash": duplicate.kept_photo.image_hash
                if duplicate.kept_photo
                else None,
                "suggested_photo_hash": suggested_photo.image_hash
                if suggested_photo
                else None,
                "photos": photo_data,
            }
        )


class DuplicateResolveView(APIView):
    """Resolve a duplicate group by selecting a photo to keep and optionally trashing others."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=DuplicateResolveRequest,
        responses=ResolveDuplicateResponseSerializer,
    )
    def post(self, request: Request, duplicate_id: str) -> Response:
        user = request_user(request)
        try:
            duplicate = Duplicate.objects.get_owned(user, id=duplicate_id)
        except Duplicate.DoesNotExist:
            raise NotFound("Duplicate group not found")

        body = parse_body(request, DuplicateResolveRequest)
        keep_photo_hash = body["keep_photo_hash"]
        trash_others = body["trash_others"]

        # Verify photo exists in duplicate group
        try:
            keep_photo = duplicate.photos.get(image_hash=keep_photo_hash)
        except Photo.DoesNotExist:
            raise ValidationError("Photo not found in this duplicate group")

        # Resolve the duplicate
        duplicate.resolve(keep_photo, trash_others)

        logger.info(
            "Resolved duplicate %s: kept %s, trashed %s",
            duplicate.id,
            keep_photo_hash,
            duplicate.trashed_count,
        )
        return Response(
            {
                "status": "resolved",
                "kept_photo": keep_photo_hash,
                "trashed_count": duplicate.trashed_count,
            }
        )


class DuplicateDismissView(APIView):
    """Dismiss a duplicate group (mark photos as not actually duplicates)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses=DismissDuplicateResponseSerializer)
    def post(self, request: Request, duplicate_id: str) -> Response:
        user = request_user(request)
        try:
            duplicate = Duplicate.objects.get_owned(user, id=duplicate_id)
        except Duplicate.DoesNotExist:
            raise NotFound("Duplicate group not found")

        duplicate.dismiss()

        logger.info("Dismissed duplicate %s", duplicate.id)
        return Response({"status": "dismissed"})


class DuplicateRevertView(APIView):
    """Revert a resolved duplicate (restore trashed photos, reset to pending)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(request=None, responses=RevertDuplicateResponseSerializer)
    def post(self, request: Request, duplicate_id: str) -> Response:
        user = request_user(request)
        try:
            duplicate = Duplicate.objects.get_owned(user, id=duplicate_id)
        except Duplicate.DoesNotExist:
            raise NotFound("Duplicate group not found")

        if duplicate.review_status != Duplicate.ReviewStatus.RESOLVED:
            raise ValidationError("Can only revert resolved duplicates")

        restored_count = duplicate.revert()

        logger.info(
            "Reverted duplicate %s: restored %s photos", duplicate.id, restored_count
        )
        return Response({"status": "reverted", "restored_count": restored_count})


class DuplicateDeleteView(APIView):
    """Delete a duplicate group (unlinks photos but doesn't delete them)."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses={200: UnlinkGroupResponseSerializer})
    def delete(self, request: Request, duplicate_id: str) -> Response:
        user = request_user(request)
        try:
            duplicate = Duplicate.objects.get_owned(user, id=duplicate_id)
        except Duplicate.DoesNotExist:
            raise NotFound("Duplicate group not found")

        # Unlink photos from this duplicate group (ManyToMany)
        photo_count = duplicate.photos.count()
        for photo in duplicate.photos.all():
            photo.duplicates.remove(duplicate)

        # Delete duplicate group
        duplicate_id_str = str(duplicate.id)
        duplicate.delete()

        logger.info(
            "Deleted duplicate group %s: unlinked %s photos",
            duplicate_id_str,
            photo_count,
        )
        return Response({"status": "deleted", "unlinked_count": photo_count})


class DetectDuplicatesView(APIView):
    """Trigger duplicate detection for the current user."""

    permission_classes = [IsAuthenticated]

    @extend_schema(
        request=DetectDuplicatesRequest,
        responses={202: DetectDuplicatesQueuedSerializer},
    )
    def post(self, request: Request) -> Response:
        from api.duplicates.detection import batch_detect_duplicates

        user = request_user(request)
        # batch_size is clamped to 100..50000: fewer would make too many
        # batches, more would use too much memory.
        options = parse_body(request, DetectDuplicatesRequest)

        [job] = enqueue_for_request(
            user,
            [
                JobStep(
                    LongRunningJob.JOB_DETECT_DUPLICATES,
                    batch_detect_duplicates,
                    (user, options),
                )
            ],
            "duplicate detection",
        )

        logger.info(
            "Duplicate detection queued for user %s with options: %s",
            user.username,
            options,
        )
        return Response(
            {
                "status": "queued",
                "message": "Duplicate detection started",
                "options": options,
                "job_id": job.job_id,
            },
            status=status.HTTP_202_ACCEPTED,
        )


class DuplicateStatsView(APIView):
    """Get duplicate statistics for the current user."""

    permission_classes = [IsAuthenticated]

    @extend_schema(responses=DuplicateStatsSerializer)
    def get(self, request: Request) -> Response:
        user = request_user(request)
        duplicates = Duplicate.objects.owned_by(user)

        # Count by type
        by_type: dict[str, int] = {}
        for dup_type in Duplicate.DuplicateType.values:
            by_type[dup_type] = duplicates.filter(duplicate_type=dup_type).count()

        # Count by review status
        pending_count = duplicates.filter(
            review_status=Duplicate.ReviewStatus.PENDING
        ).count()
        resolved_count = duplicates.filter(
            review_status=Duplicate.ReviewStatus.RESOLVED
        ).count()
        dismissed_count = duplicates.filter(
            review_status=Duplicate.ReviewStatus.DISMISSED
        ).count()

        # Calculate potential savings (from pending duplicates)
        total_savings = (
            duplicates.filter(review_status=Duplicate.ReviewStatus.PENDING).aggregate(
                total=Sum("potential_savings")
            )["total"]
            or 0
        )

        # Count photos in duplicate groups
        photos_in_duplicates = (
            Photo.objects.owned_by(user)
            .filter(duplicates__isnull=False)
            .distinct()
            .count()
        )

        total_photos = (
            Photo.objects.owned_by(user).filter(hidden=False, in_trashcan=False).count()
        )

        return Response(
            {
                "total_duplicates": duplicates.count(),
                "pending_duplicates": pending_count,
                "resolved_duplicates": resolved_count,
                "dismissed_duplicates": dismissed_count,
                "by_type": by_type,
                "photos_in_duplicates": photos_in_duplicates,
                "total_photos": total_photos,
                "potential_savings_bytes": total_savings,
                "potential_savings_mb": round(total_savings / (1024 * 1024), 2)
                if total_savings
                else 0,
            }
        )
