"""
PhotoStack model for organizational photo grouping.

Stacks represent related photos that should be kept together for organization:
- RAW+JPEG pairs (same shot in different formats)
- Burst sequences (rapid succession shots)
- Exposure brackets (HDR sequences)
- Live photos (photo + embedded motion video)
- Manual user groupings

NOTE: Duplicates (exact copies and visual duplicates) are now handled separately
by the Duplicate model in api/models/duplicate.py. Duplicates focus on storage
cleanup, while Stacks focus on photo organization.

Inspired by Immich's stacking system with focus on photo relationships.
"""

import uuid

from django.db import models

from api.models.user import User, get_deleted_user


class PhotoStack(models.Model):
    """
    Represents a group of related photos that should be treated as variations
    of the same moment/subject. Only the primary photo is shown in the timeline,
    with others accessible via expansion.
    
    Stacks are informational groupings - they help organize related photos
    but don't imply that any should be deleted (unlike Duplicates).
    """

    class StackType(models.TextChoices):
        # RAW file paired with its JPEG/HEIC counterpart
        # Both formats serve different purposes (editing vs viewing)
        RAW_JPEG_PAIR = "raw_jpeg", "RAW + JPEG Pair"
        # Photos taken in rapid succession (burst/continuous mode)
        # User may want to browse all or pick the best
        BURST_SEQUENCE = "burst", "Burst Sequence"
        # Exposure bracketed shots (for HDR)
        # HDR processing may need all exposures
        EXPOSURE_BRACKET = "bracket", "Exposure Bracket"
        # Live photos (photo + embedded video motion)
        # Photo and video are intrinsically linked
        LIVE_PHOTO = "live_photo", "Live Photo"
        # User manually grouped photos
        # User explicitly created the grouping
        MANUAL = "manual", "Manual Stack"

    id = models.UUIDField(primary_key=True, default=uuid.uuid4, editable=False)

    owner = models.ForeignKey(
        User,
        on_delete=models.SET(get_deleted_user),
        related_name="photo_stacks",
    )

    stack_type = models.CharField(
        max_length=20,
        choices=StackType.choices,
        default=StackType.RAW_JPEG_PAIR,
        db_index=True,
    )

    # The photo shown in the timeline (cover photo)
    primary_photo = models.ForeignKey(
        "Photo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="primary_in_stack",
    )

    # Detection metadata
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)

    # For bursts: time span of the sequence
    sequence_start = models.DateTimeField(null=True, blank=True)
    sequence_end = models.DateTimeField(null=True, blank=True)

    class Meta:
        ordering = ["-created_at"]
        verbose_name = "Photo Stack"
        verbose_name_plural = "Photo Stacks"
        indexes = [
            models.Index(fields=["owner", "stack_type"]),
        ]

    def __str__(self):
        return f"PhotoStack {self.id} - {self.stack_type} - {self.owner.username}"

    @property
    def photo_count(self):
        """Number of photos in this stack."""
        return self.photos.count()

    def get_photos_ordered_by_quality(self):
        """
        Returns photos in the stack ordered by quality metrics.
        Higher resolution and larger file size are considered better quality.
        """
        return self.photos.order_by("-metadata__width", "-metadata__height", "-size")

    def auto_select_primary(self):
        """
        Automatically selects the best photo as primary based on stack type.

        For RAW_JPEG_PAIR: Depends on user preference (default: JPEG for viewing)
        For BURST_SEQUENCE: Sharpest/best focused (fall back to middle of sequence)
        For EXPOSURE_BRACKET: Middle exposure
        For LIVE_PHOTO: The still image (not the video)
        For MANUAL: Highest resolution
        """
        photos = self.photos.all()
        if not photos.exists():
            return None

        if self.stack_type == self.StackType.RAW_JPEG_PAIR:
            # Prefer JPEG for display by default (faster to render)
            # RAW files have type=4 in File model
            jpeg_photos = photos.exclude(main_file__type=4)
            best = jpeg_photos.first() if jpeg_photos.exists() else photos.first()
        elif self.stack_type == self.StackType.BURST_SEQUENCE:
            # Pick middle of sequence by timestamp
            ordered = photos.order_by("exif_timestamp")
            count = ordered.count()
            best = ordered[count // 2] if count > 0 else None
        elif self.stack_type == self.StackType.EXPOSURE_BRACKET:
            # Pick middle exposure (usually the "correct" exposure)
            ordered = photos.order_by("exif_timestamp")
            count = ordered.count()
            best = ordered[count // 2] if count > 0 else None
        elif self.stack_type == self.StackType.LIVE_PHOTO:
            # For Live Photos, prefer the still image over the video
            # File.VIDEO = 2 in the File model
            still_photos = photos.exclude(main_file__type=2)
            best = still_photos.first() if still_photos.exists() else photos.first()
        else:
            # Default: highest resolution
            # Use metadata__width and metadata__height since these fields moved to PhotoMetadata
            best = photos.order_by(
                models.F("metadata__width") * models.F("metadata__height")
            ).last()

        if best:
            self.primary_photo = best
            self.save(update_fields=["primary_photo", "updated_at"])

        return best

    def merge_with(self, other_stack: "PhotoStack"):
        """
        Merge another stack into this one.
        All photos from the other stack are moved to this stack,
        and the other stack is deleted.
        """
        if other_stack.pk == self.pk:
            return

        # Move all photos from other stack to this one (ManyToMany)
        # Convert to list first to avoid modifying queryset while iterating
        photos_to_move = list(other_stack.photos.all())
        for photo in photos_to_move:
            photo.stacks.add(self)
            photo.stacks.remove(other_stack)

        # Recalculate primary if needed
        if not self.primary_photo:
            self.auto_select_primary()

        # Delete the now-empty stack
        other_stack.delete()

    @classmethod
    def create_or_merge(cls, owner, stack_type, photos, sequence_start=None, sequence_end=None):
        """
        Create a new stack or merge into existing if any photo is already stacked.

        Args:
            owner: User who owns the photos
            stack_type: Type of stack to create
            photos: Queryset or list of Photo objects to group
            sequence_start: Optional start timestamp for burst/bracket sequences
            sequence_end: Optional end timestamp for burst/bracket sequences

        Returns:
            The PhotoStack instance (new or existing)
        """
        photo_list = list(photos)
        if len(photo_list) < 2:
            return None

        # Check if any photo is already in a stack of the same type
        existing_stacks = cls.objects.filter(
            photos__in=photo_list,
            stack_type=stack_type,
            owner=owner,
        ).distinct()

        if existing_stacks.exists():
            # Merge all into the first existing stack
            target_stack = existing_stacks.first()
            for stack in existing_stacks[1:]:
                target_stack.merge_with(stack)

            # Add any new photos to the stack (ManyToMany)
            for photo in photo_list:
                if not photo.stacks.filter(pk=target_stack.pk).exists():
                    photo.stacks.add(target_stack)

            # Update sequence timestamps if provided and this is a burst/bracket stack
            if sequence_start is not None and sequence_end is not None:
                if target_stack.sequence_start is None or target_stack.sequence_start > sequence_start:
                    target_stack.sequence_start = sequence_start
                if target_stack.sequence_end is None or target_stack.sequence_end < sequence_end:
                    target_stack.sequence_end = sequence_end
                target_stack.save(update_fields=['sequence_start', 'sequence_end', 'updated_at'])

            target_stack.auto_select_primary()
            return target_stack
        else:
            # Create new stack
            stack = cls.objects.create(
                owner=owner,
                stack_type=stack_type,
                sequence_start=sequence_start,
                sequence_end=sequence_end,
            )

            # Associate photos (ManyToMany - add each photo to the stack)
            for photo in photo_list:
                photo.stacks.add(stack)

            stack.auto_select_primary()
            return stack
