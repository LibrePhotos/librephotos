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

    # Sharing options - None means inherit from user defaults, True/False overrides
    share_location = models.BooleanField(null=True, blank=True, default=None)
    share_camera_info = models.BooleanField(null=True, blank=True, default=None)
    share_timestamps = models.BooleanField(null=True, blank=True, default=None)
    share_captions = models.BooleanField(null=True, blank=True, default=None)
    share_faces = models.BooleanField(null=True, blank=True, default=None)

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

    def get_effective_sharing_settings(self) -> dict:
        """Resolve effective sharing settings.
        
        Priority: album override > user defaults > system defaults (all False)
        """
        from api.models.user import get_default_public_sharing_settings
        
        # Start with system defaults (all False)
        defaults = get_default_public_sharing_settings()
        
        # Apply user defaults if available
        user_defaults = getattr(self.album.owner, 'public_sharing_defaults', None)
        if user_defaults:
            defaults.update(user_defaults)
        
        # Apply album-level overrides (only non-None values)
        overrides = {
            'share_location': self.share_location,
            'share_camera_info': self.share_camera_info,
            'share_timestamps': self.share_timestamps,
            'share_captions': self.share_captions,
            'share_faces': self.share_faces,
        }
        
        for key, value in overrides.items():
            if value is not None:
                defaults[key] = value
        
        return defaults
