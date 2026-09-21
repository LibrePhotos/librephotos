"""Tests for the scheduled trash retention cleanup (api.services.cleanup_deleted_photos)."""

from datetime import timedelta

from django.test import TestCase
from django.utils import timezone

from api.models import Photo
from api.services import cleanup_deleted_photos
from api.tests.utils import create_test_photo, create_test_user


def _set_last_modified(photo, when):
    """last_modified is auto_now, so it can only be back-dated with a queryset update."""
    Photo.objects.filter(pk=photo.pk).update(last_modified=when)


class CleanupDeletedPhotosTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_only_photos_removed_longer_than_retention_are_purged(self):
        now = timezone.now()
        old_photo = create_test_photo(owner=self.user, removed=True)
        _set_last_modified(old_photo, now - timedelta(days=60))
        recent_photo = create_test_photo(owner=self.user, removed=True)
        _set_last_modified(recent_photo, now - timedelta(days=1))

        cleanup_deleted_photos()

        self.assertTrue(
            Photo.objects.filter(pk=recent_photo.pk).exists(),
            "a photo removed 1 day ago must still be inside the retention window",
        )
        self.assertFalse(
            Photo.objects.filter(pk=old_photo.pk).exists(),
            "a photo removed 60 days ago must be purged",
        )

    def test_photos_not_removed_are_never_purged(self):
        photo = create_test_photo(owner=self.user)
        _set_last_modified(photo, timezone.now() - timedelta(days=365))

        cleanup_deleted_photos()

        self.assertTrue(Photo.objects.filter(pk=photo.pk).exists())
