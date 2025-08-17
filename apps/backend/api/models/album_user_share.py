import uuid
from django.db import models
from django.utils import timezone

from api.models.album_user import AlbumUser


class AlbumUserShare(models.Model):
    album = models.OneToOneField(
        AlbumUser, on_delete=models.CASCADE, related_name="share"
    )
    enabled = models.BooleanField(default=False, db_index=True)
    slug = models.SlugField(
        max_length=64, unique=True, null=True, blank=True, db_index=True
    )
    expires_at = models.DateTimeField(null=True, blank=True, db_index=True)

    def ensure_slug(self) -> None:
        if self.enabled and not self.slug:
            base = uuid.uuid4().hex[:12]
            candidate = base
            idx = 0
            while (
                AlbumUserShare.objects.filter(slug=candidate)
                .exclude(id=self.id)
                .exists()
            ):
                idx += 1
                candidate = f"{base}-{idx}"
            self.slug = candidate

    def is_active(self) -> bool:
        if not self.enabled:
            return False
        if self.expires_at is None:
            return True
        return self.expires_at >= timezone.now()

    def save(self, *args, **kwargs):
        if self.enabled and not self.slug:
            self.ensure_slug()
        super().save(*args, **kwargs)
