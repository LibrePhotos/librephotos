"""
Duplicate model for tracking duplicate photo groups.

Duplicates are photos that are either:
- EXACT_COPY: Byte-for-byte identical files (same MD5 hash, different paths)
- VISUAL_DUPLICATE: Visually similar photos (similar perceptual hash or CLIP embeddings)

Duplicates are fundamentally different from Stacks:
- Duplicates represent redundant storage that the user may want to clean up
- Stacks represent related photos that should be kept together for organization

This separation allows:
- Focused workflows: Duplicates → review/delete, Stacks → browse/organize
- Different UX: Duplicates page focused on storage savings vs Stacks for browsing
- Clearer data model with appropriate fields for each concept
"""

from __future__ import annotations

import uuid
from collections.abc import Iterable
from typing import TYPE_CHECKING

from django.db import models, transaction
from django.db.models import Model, QuerySet
from django.utils import timezone

from api.models.scopes import OwnedQuerySet
from api.models.user import User, get_deleted_user

if TYPE_CHECKING:
    from typing import Self

    from django.db.models.fields.related_descriptors import ManyRelatedManager

    from api.models.photo import Photo


class DuplicateQuerySet(OwnedQuerySet["Duplicate"]):
    """Scoped to its owner through ``owner``."""


# The tags and the people that count some photos: (tag ids, person ids).
Counted = tuple[list[int], list[int]]


def _counted_on(photos: QuerySet[Photo]) -> Counted:
    """The tags and people of ``photos``, read before trashing or restoring them."""
    from api.models.person import person_ids_for_photos
    from api.models.tag import tag_ids_for_photos

    return tag_ids_for_photos(photos), person_ids_for_photos(photos)


def _refresh_counts(counted: Counted) -> None:
    """Trashing and restoring are plain UPDATEs, which fire no m2m signal: the
    tags' photo counts and the people's face counts are refreshed by hand."""
    from api.models.person import refresh_person_face_counts
    from api.models.tag import refresh_tag_photo_counts

    tag_ids, person_ids = counted
    refresh_tag_photo_counts(tag_ids)
    refresh_person_face_counts(person_ids)


class Duplicate(models.Model):
    """
    Represents a group of duplicate photos that should be reviewed.

    Photos in a duplicate group are candidates for deletion - the user
    reviews them and decides which to keep.
    """

    class DuplicateType(models.TextChoices):
        # Exact byte-for-byte copies (same MD5 hash, different file paths)
        EXACT_COPY = "exact_copy", "Exact Copies"
        # Visually similar images (similar pHash or CLIP embeddings)
        VISUAL_DUPLICATE = "visual_duplicate", "Visual Duplicates"

    class ReviewStatus(models.TextChoices):
        # User hasn't reviewed yet
        PENDING = "pending", "Pending Review"
        # User selected a primary and trashed others
        RESOLVED = "resolved", "Resolved"
        # User marked as "not actually duplicates"
        DISMISSED = "dismissed", "Dismissed"

    # Reverse side of Photo.duplicates (related_name="photos"). Annotation only:
    # Django installs the manager at class creation; this tells mypy its type.
    photos: ManyRelatedManager[Photo, Model]

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    owner = models.ForeignKey(
        User,
        on_delete=models.SET(get_deleted_user),
        related_name="duplicates",
    )

    duplicate_type = models.CharField(
        max_length=20,
        choices=DuplicateType.choices,
        default=DuplicateType.VISUAL_DUPLICATE,
        db_index=True,
    )

    review_status = models.CharField(
        max_length=20,
        choices=ReviewStatus.choices,
        default=ReviewStatus.PENDING,
        db_index=True,
    )

    # The photo the user chose to keep (set when resolved)
    kept_photo = models.ForeignKey(
        "Photo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="kept_in_duplicates",
    )

    # Detection metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    # For visual duplicates: similarity score (0-1, higher = more similar)
    similarity_score = models.FloatField(null=True, blank=True)

    # Potential storage savings if non-kept photos are removed (bytes)
    potential_savings = models.BigIntegerField(default=0)

    # Number of photos trashed when resolved
    trashed_count = models.IntegerField(default=0)

    # The photos the resolve moved to the trash, which a revert takes out again.
    trashed_photos: models.ManyToManyField[Photo, Model] = models.ManyToManyField(
        "Photo", blank=True, related_name="trashed_by_duplicates"
    )

    # Optional note from user
    note = models.TextField(blank=True, null=True)

    objects = DuplicateQuerySet.as_manager()

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Duplicate"
        verbose_name_plural = "Duplicates"
        indexes = [
            models.Index(fields=["owner", "duplicate_type"]),
            models.Index(fields=["owner", "review_status"]),
        ]

    def __str__(self) -> str:
        return f"Duplicate {self.id} - {self.duplicate_type} - {self.owner.username}"

    @property
    def photo_count(self) -> int:
        """Number of photos in this duplicate group."""
        return self.photos.count()

    def auto_select_best_photo(self) -> Photo | None:
        """
        Automatically selects the best quality photo as the kept photo.
        Used as a suggestion for the user.

        For EXACT_COPY: Picks the one with shortest path (likely "original")
        For VISUAL_DUPLICATE: Highest resolution

        Returns:
            The best Photo instance or None
        """
        from django.db.models.functions import Length

        # api.models.photo imports this module.
        from api.models.photo import highest_resolution_first

        photos = self.photos.all()
        if not photos.exists():
            return None

        if self.duplicate_type == self.DuplicateType.EXACT_COPY:
            # For exact copies, pick the one with shortest path (likely "original")
            best = photos.order_by(Length("main_file__path")).first()
        else:
            best = highest_resolution_first(photos).first()

        return best

    def calculate_potential_savings(self) -> int:
        """
        Calculate how much storage could be saved if non-best photos
        are removed from disk.
        """
        best = self.auto_select_best_photo()
        if not best:
            self.potential_savings = 0
        else:
            # Sum size of all photos except best
            from django.db.models import Sum

            non_best_size = (
                self.photos.exclude(pk=best.pk)
                .aggregate(total=Sum("size"))
                .get("total", 0)
            ) or 0
            self.potential_savings = non_best_size

        self.save(update_fields=["potential_savings", "updated_at"])
        return self.potential_savings

    # What a review writes; the lock in ``_lock`` makes the rest current.
    REVIEW_FIELDS = (
        "review_status",
        "kept_photo",
        "reviewed_at",
        "trashed_count",
        "updated_at",
    )

    def _lock(self) -> None:
        """Hold this group's row until the transaction ends, and read it.

        Two requests (a double click, two tabs) may hold a copy of the group
        loaded before the other's review; each review starts from the row.
        """
        self.refresh_from_db(from_queryset=Duplicate.objects.select_for_update())

    def _trash(self, photo_ids: list[uuid.UUID]) -> int:
        """Trash ``photo_ids`` and remember them as this group's doing."""
        from api.models.photo import Photo, trash_photos

        photos = Photo.objects.filter(pk__in=photo_ids)
        counted = _counted_on(photos)
        trashed = trash_photos(photos)
        _refresh_counts(counted)
        self.trashed_photos.set(photos)
        return trashed

    def _undo_resolution(self) -> int:
        """Take the photos this group's resolve trashed out of the trash.

        Only those: a photo of the group trashed on its own, before or after
        the resolve, stays where the user put it. Returns how many came back.
        """
        from api.models.photo import Photo, restore_photos

        photo_ids = list(
            self.trashed_photos.filter(in_trashcan=True).values_list("pk", flat=True)
        )
        photos = Photo.objects.filter(pk__in=photo_ids)
        counted = _counted_on(photos)
        restored = restore_photos(photos)
        _refresh_counts(counted)
        self.trashed_photos.clear()
        self.trashed_count = 0
        return restored

    def resolve(self, kept_photo: Photo, trash_others: bool = True) -> Self:
        """Keep ``kept_photo`` and, with ``trash_others``, trash the others.

        Resolving a resolved group picks again: what the first resolve
        trashed comes back first. A photo already in the trash is not this
        group's doing, so revert leaves it there.
        """
        with transaction.atomic():
            self._lock()
            self._undo_resolution()
            if trash_others:
                others = self.photos.exclude(pk=kept_photo.pk).filter(in_trashcan=False)
                self.trashed_count = self._trash(
                    list(others.values_list("pk", flat=True))
                )
            self.kept_photo = kept_photo
            self.review_status = self.ReviewStatus.RESOLVED
            self.reviewed_at = timezone.now()
            self.save(update_fields=self.REVIEW_FIELDS)
        return self

    def dismiss(self) -> Self:
        """ "Not duplicates": the group stays, with its photos, so detection
        does not offer them again (``create_or_merge``). A resolve is undone."""
        with transaction.atomic():
            self._lock()
            self._undo_resolution()
            self.kept_photo = None
            self.review_status = self.ReviewStatus.DISMISSED
            self.reviewed_at = timezone.now()
            self.save(update_fields=self.REVIEW_FIELDS)
        return self

    def revert(self) -> int:
        """Back to pending, with what the resolve trashed out of the trash.

        Returns how many photos came back; 0 for a group that is not resolved.
        """
        with transaction.atomic():
            self._lock()
            if self.review_status != self.ReviewStatus.RESOLVED:
                return 0
            restored = self._undo_resolution()
            self.kept_photo = None
            self.review_status = self.ReviewStatus.PENDING
            self.reviewed_at = None
            self.save(update_fields=self.REVIEW_FIELDS)
        return restored

    def _reopen_if_grown(self, photo_ids_before: set[uuid.UUID]) -> None:
        """A dismissed group that gained a photo asks again: "not duplicates"
        was said of the photos it had."""
        if self.review_status != self.ReviewStatus.DISMISSED:
            return
        if not self.photos.exclude(pk__in=photo_ids_before).exists():
            return
        Duplicate.objects.filter(
            pk=self.pk, review_status=self.ReviewStatus.DISMISSED
        ).update(review_status=self.ReviewStatus.PENDING, reviewed_at=None)
        self.review_status = self.ReviewStatus.PENDING
        self.reviewed_at = None

    def merge_with(self, other_duplicate: Duplicate) -> None:
        """
        Merge another duplicate group into this one.
        All photos from the other group are moved here,
        and the other group is deleted.
        """
        if other_duplicate.pk == self.pk:
            return

        # Move all photos from other duplicate to this one (ManyToMany)
        for photo in other_duplicate.photos.all():
            photo.duplicates.add(self)
            photo.duplicates.remove(other_duplicate)

        self.calculate_potential_savings()

        # Delete the now-empty duplicate group
        other_duplicate.delete()

    @classmethod
    def create_or_merge(
        cls,
        owner: User,
        duplicate_type: str,
        photos: Iterable[Photo],
        similarity_score: float | None = None,
    ) -> Duplicate | None:
        """
        Create a new duplicate group or merge into existing if any photo is already grouped.

        Args:
            owner: User who owns the photos
            duplicate_type: Type of duplicate (EXACT_COPY or VISUAL_DUPLICATE)
            photos: Queryset or list of Photo objects to group
            similarity_score: Optional similarity score for visual duplicates

        Returns:
            The Duplicate instance (new or existing)
        """
        photo_list = list(photos)
        if len(photo_list) < 2:
            return None

        # Check if any photo is already in a duplicate group of the same type
        existing_duplicates = cls.objects.filter(
            photos__in=photo_list,
            duplicate_type=duplicate_type,
            owner=owner,
        ).distinct()

        if existing_duplicates.exists():
            # Merge all into the first existing duplicate group
            target_duplicate = existing_duplicates.first()
            # exists() just returned True for this same queryset.
            assert target_duplicate is not None
            photo_ids_before = set(target_duplicate.photos.values_list("pk", flat=True))
            for duplicate in existing_duplicates[1:]:
                target_duplicate.merge_with(duplicate)

            # Add any new photos to the group (ManyToMany)
            for photo in photo_list:
                if not photo.duplicates.filter(pk=target_duplicate.pk).exists():
                    photo.duplicates.add(target_duplicate)

            target_duplicate._reopen_if_grown(photo_ids_before)
            target_duplicate.calculate_potential_savings()
            return target_duplicate
        else:
            # Create new duplicate group
            duplicate = cls.objects.create(
                owner=owner,
                duplicate_type=duplicate_type,
                similarity_score=similarity_score,
            )

            # Associate photos (ManyToMany)
            for photo in photo_list:
                photo.duplicates.add(duplicate)

            duplicate.calculate_potential_savings()
            return duplicate
