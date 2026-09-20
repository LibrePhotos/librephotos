import uuid

from django.db import models

from api.models.photo import Photo


class PhotoShare(models.Model):
    """A revocable public share for a single photo.

    The lightbox used to hand out ``/media/thumbnails_big/<image_hash>``, a URL
    derived from the file content, so it never changed and could not be
    withdrawn without deleting the photo (issue #2028). A share carries its own
    random slug instead, and revoking drops that slug so the next share mints a
    fresh one - the same rule album shares follow since #2019.
    """

    photo = models.OneToOneField(Photo, on_delete=models.CASCADE, related_name="share")
    enabled = models.BooleanField(default=False, db_index=True)
    slug = models.SlugField(
        max_length=64, unique=True, null=True, blank=True, db_index=True
    )
    created_at = models.DateTimeField(auto_now_add=True)

    def ensure_slug(self) -> None:
        if self.enabled and not self.slug:
            base = uuid.uuid4().hex[:12]
            candidate = base
            idx = 0
            while (
                PhotoShare.objects.filter(slug=candidate).exclude(id=self.id).exists()
            ):
                idx += 1
                candidate = f"{base}-{idx}"
            self.slug = candidate

    def is_active(self) -> bool:
        return bool(self.enabled and self.slug)

    def rotate(self) -> None:
        """Mint a new slug, so the previous link stops working immediately."""
        self.slug = None
        self.enabled = True
        self.ensure_slug()

    def save(self, *args, **kwargs):
        if self.enabled and not self.slug:
            self.ensure_slug()
        super().save(*args, **kwargs)

    def get_effective_sharing_settings(self) -> dict:
        """Resolve what metadata this share exposes.

        Photo shares have no per-share overrides, so this is the owner's
        defaults on top of the system defaults (all False).
        """
        from api.models.user import get_default_public_sharing_settings

        defaults = get_default_public_sharing_settings()
        user_defaults = getattr(self.photo.owner, "public_sharing_defaults", None)
        if user_defaults:
            defaults.update(user_defaults)
        return defaults
