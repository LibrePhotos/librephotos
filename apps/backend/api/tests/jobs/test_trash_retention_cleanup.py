"""The daily cleanup: the trash retention (``empty_expired_trash``, #2203) and
the removed-photo cleanup (``cleanup_deleted_photos``)."""

import os
from datetime import timedelta
from unittest.mock import patch

from constance.test import override_config
from django.core.management import call_command
from django.test import TestCase
from django.utils import timezone
from django_q.models import Schedule

from api.models import Photo
from api.photos import files
from api.photos.retention import cleanup_deleted_photos, empty_expired_trash
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

    def test_a_row_that_fails_to_delete_does_not_stop_the_sweep(self):
        now = timezone.now()
        photos = [create_test_photo(owner=self.user, removed=True) for _ in range(2)]
        for photo in photos:
            _set_last_modified(photo, now - timedelta(days=60))
        broken = photos[0].pk
        real_delete = Photo.delete

        def delete(photo, *args, **kwargs):
            if photo.pk == broken:
                raise RuntimeError("row is locked")
            return real_delete(photo, *args, **kwargs)

        with (
            patch.object(Photo, "delete", delete),
            self.assertLogs("api.photos.retention", "ERROR") as logs,
        ):
            cleanup_deleted_photos()

        self.assertTrue(Photo.objects.filter(pk=broken).exists())
        self.assertFalse(Photo.objects.filter(pk=photos[1].pk).exists())
        self.assertIn(photos[0].image_hash, logs.output[0])


def _trashed(owner, days_ago):
    return create_test_photo(
        owner=owner,
        in_trashcan=True,
        trashed_at=timezone.now() - timedelta(days=days_ago),
    )


def _is_deleted(photo):
    photo = Photo.objects.get(pk=photo.pk)
    return photo.removed


class EmptyExpiredTrashTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def test_retention_off_deletes_nothing(self):
        photo = _trashed(self.user, days_ago=3650)

        with override_config(TRASH_RETENTION_DAYS=0):
            self.assertEqual(empty_expired_trash(), 0)

        self.assertFalse(_is_deleted(photo))

    def test_off_is_the_default(self):
        photo = _trashed(self.user, days_ago=3650)

        self.assertEqual(empty_expired_trash(), 0)

        self.assertFalse(_is_deleted(photo))

    @override_config(TRASH_RETENTION_DAYS=30)
    def test_only_photos_trashed_longer_than_the_retention_are_deleted(self):
        inside = _trashed(self.user, days_ago=29)
        outside = _trashed(self.user, days_ago=31)
        # As a scan links it: the main file is one of the photo's files.
        outside.files.add(outside.main_file)
        path = outside.main_file.path

        self.assertEqual(empty_expired_trash(), 1)

        self.assertFalse(_is_deleted(inside))
        self.assertTrue(_is_deleted(outside))
        # Deleted for good: the original file goes too.
        self.assertFalse(os.path.exists(path))

    @override_config(TRASH_RETENTION_DAYS=30)
    def test_every_users_trash_is_emptied(self):
        other = _trashed(create_test_user(), days_ago=31)

        self.assertEqual(empty_expired_trash(), 1)

        self.assertTrue(_is_deleted(other))

    @override_config(TRASH_RETENTION_DAYS=30)
    def test_photos_outside_the_trash_or_without_a_date_stay(self):
        kept = create_test_photo(owner=self.user)
        Photo.objects.filter(pk=kept.pk).update(
            trashed_at=timezone.now() - timedelta(days=90)
        )
        undated = create_test_photo(owner=self.user, in_trashcan=True, trashed_at=None)

        self.assertEqual(empty_expired_trash(), 0)

        self.assertFalse(_is_deleted(kept))
        self.assertFalse(_is_deleted(undated))

    @override_config(TRASH_RETENTION_DAYS=30)
    def test_a_photo_that_fails_is_logged_and_skipped(self):
        broken = _trashed(self.user, days_ago=31)
        fine = _trashed(self.user, days_ago=31)
        real_remove = files.remove_photo

        def remove(photo):
            if photo.pk == broken.pk:
                raise PermissionError("read-only library")
            real_remove(photo)

        with (
            patch.object(files, "remove_photo", remove),
            self.assertLogs("api.photos.files", "ERROR") as logs,
        ):
            self.assertEqual(empty_expired_trash(), 1)

        self.assertFalse(_is_deleted(broken))
        self.assertTrue(_is_deleted(fine))
        self.assertIn(broken.image_hash, logs.output[0])


class CleaningScheduleTest(TestCase):
    def test_the_cleaning_service_schedules_the_trash_retention_daily(self):
        call_command("start_cleaning_service")

        schedule = Schedule.objects.get(func="api.photos.retention.empty_expired_trash")
        self.assertEqual(schedule.schedule_type, Schedule.DAILY)
