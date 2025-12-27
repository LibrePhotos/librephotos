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

import uuid

from django.db import models
from django.utils import timezone

from api.models.user import User, get_deleted_user


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

    # Optional note from user
    note = models.TextField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Duplicate"
        verbose_name_plural = "Duplicates"
        indexes = [
            models.Index(fields=["owner", "duplicate_type"]),
            models.Index(fields=["owner", "review_status"]),
        ]

    def __str__(self):
        return f"Duplicate {self.id} - {self.duplicate_type} - {self.owner.username}"

    @property
    def photo_count(self):
        """Number of photos in this duplicate group."""
        return self.photos.count()

    def get_photos_ordered_by_quality(self):
        """
        Returns photos ordered by quality metrics.
        Higher resolution and larger file size are considered better quality.
        """
        return self.photos.select_related('metadata').order_by(
            "-metadata__width", "-metadata__height", "-size"
        )

    def auto_select_best_photo(self):
        """
        Automatically selects the best quality photo as the kept photo.
        Used as a suggestion for the user.
        
        For EXACT_COPY: Picks the one with shortest path (likely "original")
        For VISUAL_DUPLICATE: Highest resolution
        
        Returns:
            The best Photo instance or None
        """
        from django.db.models.functions import Length
        
        photos = self.photos.all()
        if not photos.exists():
            return None

        if self.duplicate_type == self.DuplicateType.EXACT_COPY:
            # For exact copies, pick the one with shortest path (likely "original")
            best = photos.order_by(Length("main_file__path")).first()
        else:
            # For visual duplicates: highest resolution
            from django.db.models import F
            best = photos.order_by(
                F("metadata__width") * F("metadata__height")
            ).last()

        return best

    def calculate_potential_savings(self):
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

    def resolve(self, kept_photo, trash_others: bool = True):
        """
        Mark the duplicate as resolved by selecting a photo to keep.
        
        Args:
            kept_photo: The Photo instance to keep
            trash_others: Whether to move other photos to trash
        """
        # Set the kept photo
        self.kept_photo = kept_photo
        self.review_status = self.ReviewStatus.RESOLVED
        self.reviewed_at = timezone.now()

        # Trash others if requested
        if trash_others:
            other_photos = self.photos.exclude(pk=kept_photo.pk)
            self.trashed_count = other_photos.update(in_trashcan=True)
        
        self.save()
        return self

    def dismiss(self):
        """Mark as 'not actually duplicates' and unlink photos from group."""
        self.review_status = self.ReviewStatus.DISMISSED
        self.reviewed_at = timezone.now()
        
        # Unlink photos from duplicate group (ManyToMany)
        for photo in self.photos.all():
            photo.duplicates.remove(self)
        
        self.save()
        return self

    def revert(self):
        """Revert a resolved duplicate, restoring trashed photos."""
        if self.review_status != self.ReviewStatus.RESOLVED:
            return 0

        # Restore trashed photos in this duplicate group
        restored_count = self.photos.filter(
            in_trashcan=True
        ).update(in_trashcan=False)

        # Reset to pending
        self.review_status = self.ReviewStatus.PENDING
        self.kept_photo = None
        self.trashed_count = 0
        self.reviewed_at = None

        self.save()
        return restored_count

    def merge_with(self, other_duplicate: "Duplicate"):
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
    def create_or_merge(cls, owner, duplicate_type, photos, similarity_score=None):
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
            for duplicate in existing_duplicates[1:]:
                target_duplicate.merge_with(duplicate)

            # Add any new photos to the group (ManyToMany)
            for photo in photo_list:
                if not photo.duplicates.filter(pk=target_duplicate.pk).exists():
                    photo.duplicates.add(target_duplicate)

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
