from django.db import models

from api.models.user import User, get_deleted_user


class DuplicateGroup(models.Model):
    """
    Represents a group of photos that are visually similar (duplicates).
    Photos in the same group share similar perceptual hashes.
    """

    class Status(models.TextChoices):
        PENDING = "pending", "Pending Review"
        REVIEWED = "reviewed", "Reviewed"
        DISMISSED = "dismissed", "Dismissed (Not Duplicates)"

    owner = models.ForeignKey(
        User, on_delete=models.SET(get_deleted_user), related_name="duplicate_groups"
    )
    created_at = models.DateTimeField(auto_now_add=True)
    updated_at = models.DateTimeField(auto_now=True)
    status = models.CharField(
        max_length=20, choices=Status.choices, default=Status.PENDING, db_index=True
    )
    # The photo the user has chosen to keep as the "best" version
    preferred_photo = models.ForeignKey(
        "Photo",
        on_delete=models.SET_NULL,
        null=True,
        blank=True,
        related_name="preferred_in_group",
    )

    class Meta:
        ordering = ["-created_at"]

    def __str__(self):
        return f"DuplicateGroup {self.id} - {self.owner.username} - {self.status}"

    @property
    def photo_count(self):
        return self.photos.count()

    def get_photos_ordered_by_quality(self):
        """
        Returns photos in the group ordered by quality metrics.
        Higher resolution and larger file size are considered better quality.
        """
        return self.photos.order_by("-width", "-height", "-size")

    def auto_select_preferred(self):
        """
        Automatically selects the highest quality photo as preferred.
        Quality is determined by resolution (width * height) and file size.
        """
        best_photo = self.photos.order_by(
            models.F("width") * models.F("height")
        ).last()
        if best_photo:
            self.preferred_photo = best_photo
            self.save(update_fields=["preferred_photo"])
        return best_photo
