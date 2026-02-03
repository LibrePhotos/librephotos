"""
StackReview model for tracking user review decisions on reviewable stacks.

This model is separate from PhotoStack because:
1. Only certain stack types need review (exact_copy, visual_duplicate)
2. Other stack types (raw_jpeg, burst, bracket, live_photo) are informational
3. Manual stacks are always "reviewed" by definition (user created them)

This separation allows:
- Clean data model with clear semantics
- Different workflows for different stack types
- Historical tracking of review decisions
"""

import uuid

from django.db import models

from api.models.photo_stack import PhotoStack
from api.models.user import User, get_deleted_user


class StackReview(models.Model):
    """
    Records a user's review decision for a reviewable stack.
    
    Reviewable stack types:
    - exact_copy: User decides which copy to keep
    - visual_duplicate: User decides if photos are truly duplicates
    
    Non-reviewable stack types (informational only):
    - raw_jpeg: Both RAW and JPEG are kept (different purposes)
    - burst: User may want to browse all burst photos
    - bracket: HDR processing may need all exposures
    - live_photo: Photo and video are intrinsically linked
    - manual: User explicitly created the grouping
    """

    class Decision(models.TextChoices):
        # User hasn't reviewed yet
        PENDING = "pending", "Pending Review"
        # User selected a primary and trashed others
        RESOLVED = "resolved", "Resolved"
        # User marked as "not actually duplicates"
        DISMISSED = "dismissed", "Dismissed"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    stack = models.OneToOneField(
        PhotoStack,
        on_delete=models.CASCADE,
        related_name="review",
    )

    reviewer = models.ForeignKey(
        User,
        on_delete=models.SET(get_deleted_user),
        related_name="stack_reviews",
    )

    decision = models.CharField(
        max_length=20,
        choices=Decision.choices,
        default=Decision.PENDING,
        db_index=True,
    )

    # The photo the user chose to keep (only set when decision=RESOLVED)
    kept_photo = models.ForeignKey(
        "Photo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="kept_in_reviews",
    )

    # Number of photos trashed when resolved
    trashed_count = models.IntegerField(default=0)

    # Timestamps
    created_at = models.DateTimeField(auto_now_add=True)
    reviewed_at = models.DateTimeField(null=True, blank=True)

    # Optional note from user
    note = models.TextField(blank=True, null=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Stack Review"
        verbose_name_plural = "Stack Reviews"
        indexes = [
            models.Index(fields=["reviewer", "decision"]),
        ]

    def __str__(self):
        return f"Review for {self.stack.id} - {self.decision}"

    @classmethod
    def is_reviewable_type(cls, stack_type: str) -> bool:
        """
        Check if a stack type requires user review.
        
        Currently no stack types are reviewable because:
        - exact_copy and visual_duplicate are now handled by Duplicate model
        - BURST_SEQUENCE, EXPOSURE_BRACKET, MANUAL are informational
        - RAW_JPEG_PAIR and LIVE_PHOTO are deprecated (use Photo.files)
        
        Returns:
            False for all current stack types
        """
        # No current stack types require review
        # Duplicates are handled by the separate Duplicate model
        return False

    @classmethod
    def create_for_stack(cls, stack: PhotoStack) -> "StackReview | None":
        """
        Create a review record for a stack if it's a reviewable type.
        Returns None for non-reviewable stack types.
        """
        if not cls.is_reviewable_type(stack.stack_type):
            return None

        review, created = cls.objects.get_or_create(
            stack=stack,
            defaults={
                "reviewer": stack.owner,
                "decision": cls.Decision.PENDING,
            }
        )
        return review

    def resolve(self, kept_photo, trash_others: bool = True):
        """
        Mark the review as resolved by selecting a photo to keep.
        
        Args:
            kept_photo: The Photo instance to keep as primary
            trash_others: Whether to move other photos to trash
        """
        from django.utils import timezone

        # Set the kept photo
        self.kept_photo = kept_photo
        self.decision = self.Decision.RESOLVED
        self.reviewed_at = timezone.now()

        # Also set as stack's primary photo
        self.stack.primary_photo = kept_photo
        self.stack.save(update_fields=["primary_photo", "updated_at"])

        # Trash others if requested
        if trash_others:
            other_photos = self.stack.photos.exclude(pk=kept_photo.pk)
            self.trashed_count = other_photos.update(in_trashcan=True)
        
        self.save()
        return self

    def dismiss(self):
        """Mark as 'not actually duplicates' and unlink photos from stack."""
        from django.utils import timezone

        self.decision = self.Decision.DISMISSED
        self.reviewed_at = timezone.now()
        
        # Unlink photos from stack (ManyToMany)
        for photo in self.stack.photos.all():
            photo.stacks.remove(self.stack)
        
        self.save()
        return self

    def revert(self):
        """Revert a resolved review, restoring trashed photos."""
        if self.decision != self.Decision.RESOLVED:
            return self

        # Restore trashed photos in this stack (using ManyToMany relationship)
        restored_count = self.stack.photos.filter(
            in_trashcan=True
        ).update(in_trashcan=False)

        # Reset to pending
        self.decision = self.Decision.PENDING
        self.kept_photo = None
        self.trashed_count = 0
        self.reviewed_at = None
        
        # Clear stack's primary
        self.stack.primary_photo = None
        self.stack.save(update_fields=["primary_photo", "updated_at"])

        self.save()
        return restored_count
