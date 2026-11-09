"""The photo lifecycle: trash, restore, hide, archive, public, rating, removal.

These flags are written by queryset UPDATEs (``trash_photos``,
``restore_photos``, the bulk ``photosedit`` views) while scans and edits hold
a ``Photo`` they loaded earlier. A full-row ``save()`` of such an instance
used to write the old flags back, and ``remove_photo`` deleted the files of a
photo restored after the Empty trash job listed it.
"""

import os
from datetime import timedelta
from unittest import mock

from django.test import TestCase
from django.utils import timezone
from rest_framework.test import APIClient

from api.metadata.photo_datetime import extract_date_time
from api.models import LongRunningJob, Person, Photo
from api.models.photo import restore_photos, trash_photos
from api.photos import files
from api.photos.files import remove_photo
from api.photos.retention import cleanup_deleted_photos, empty_trash_job
from api.tests.utils import (
    create_test_face,
    create_test_file,
    create_test_job,
    create_test_person,
    create_test_photo,
    create_test_user,
)


def _row(photo: Photo) -> Photo:
    return Photo.objects.get(pk=photo.pk)


class StaleFullSaveTest(TestCase):
    """A full save of an instance loaded before a lifecycle write keeps it."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        # What a scan or an edit holds while the user acts on the photo.
        self.stale = _row(self.photo)

    def test_a_stale_save_does_not_take_a_photo_out_of_the_trash(self):
        trash_photos(Photo.objects.filter(pk=self.photo.pk))

        self.stale.local_orientation = 6
        self.stale.save()

        row = _row(self.photo)
        self.assertTrue(row.in_trashcan)
        self.assertIsNotNone(row.trashed_at)
        self.assertEqual(row.local_orientation, 6)

    def test_a_stale_save_does_not_put_a_restored_photo_back_in_the_trash(self):
        trash_photos(Photo.objects.filter(pk=self.photo.pk))
        stale = _row(self.photo)
        restore_photos(Photo.objects.filter(pk=self.photo.pk))

        stale.save()

        row = _row(self.photo)
        self.assertFalse(row.in_trashcan)
        self.assertIsNone(row.trashed_at)

    def test_a_stale_save_keeps_hide_archive_public_and_rating(self):
        Photo.objects.filter(pk=self.photo.pk).update(
            hidden=True, archived=True, public=True, rating=4
        )

        self.stale.save()

        row = _row(self.photo)
        self.assertEqual(
            (row.hidden, row.archived, row.public, row.rating), (True, True, True, 4)
        )

    def test_the_scan_date_read_keeps_a_photo_trashed_while_it_ran(self):
        self.stale.timestamp = timezone.now()
        trash_photos(Photo.objects.filter(pk=self.photo.pk))

        extract_date_time(self.stale, commit=True)

        row = _row(self.photo)
        self.assertTrue(row.in_trashcan)
        self.assertEqual(row.exif_timestamp, self.stale.exif_timestamp)

    def test_a_flag_the_instance_changed_itself_is_written(self):
        self.stale.rating = 3
        self.stale.hidden = True

        self.stale.save()

        row = _row(self.photo)
        self.assertEqual((row.rating, row.hidden), (3, True))

    def test_refresh_from_db_takes_the_current_flags_as_loaded(self):
        trash_photos(Photo.objects.filter(pk=self.photo.pk))
        self.stale.refresh_from_db()
        restore_photos(Photo.objects.filter(pk=self.photo.pk))

        self.stale.save()

        self.assertFalse(_row(self.photo).in_trashcan)

    def test_a_save_of_a_new_photo_writes_every_field(self):
        photo = create_test_photo(owner=self.user, hidden=True, rating=2)

        row = _row(photo)
        self.assertEqual((row.hidden, row.rating), (True, 2))

    def test_a_save_after_a_save_writes_only_what_changed_since(self):
        self.stale.rating = 5
        self.stale.save()
        Photo.objects.filter(pk=self.photo.pk).update(rating=1)

        self.stale.save()

        self.assertEqual(_row(self.photo).rating, 1)


def _with_file_on_disk(photo: Photo, user) -> str:
    file = create_test_file(None, user, on_disk=True)
    photo.files.add(file)
    return file.path


class RemovePhotoTransitionTest(TestCase):
    """``remove_photo`` takes a photo from the trash to removed, or not at all."""

    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user, in_trashcan=True)
        self.path = _with_file_on_disk(self.photo, self.user)

    def test_a_photo_restored_after_it_was_listed_is_not_removed(self):
        listed = _row(self.photo)
        restore_photos(Photo.objects.filter(pk=self.photo.pk))

        with self.captureOnCommitCallbacks(execute=True):
            self.assertFalse(remove_photo(listed))

        row = _row(self.photo)
        self.assertFalse(row.removed)
        self.assertFalse(row.in_trashcan)
        self.assertTrue(os.path.exists(self.path))
        self.assertEqual(row.files.count(), 1)

    def test_a_removed_photo_is_removed_with_its_files(self):
        with self.captureOnCommitCallbacks(execute=True):
            self.assertTrue(remove_photo(self.photo))

        row = _row(self.photo)
        self.assertTrue(row.removed)
        self.assertIsNotNone(row.removed_at)
        self.assertIsNone(row.main_file)
        self.assertFalse(os.path.exists(self.path))
        self.assertTrue(self.photo.removed)

    def test_a_file_that_cannot_be_deleted_leaves_the_photo_untouched(self):
        second = _with_file_on_disk(self.photo, self.user)
        real_replace = os.replace
        calls = []

        def replace(src, dst):
            calls.append(src)
            if len(calls) == 2:
                raise PermissionError("read-only")
            return real_replace(src, dst)

        with (
            mock.patch("api.photos.files.os.replace", side_effect=replace),
            self.assertRaises(PermissionError),
            self.captureOnCommitCallbacks(execute=True),
        ):
            remove_photo(self.photo)

        row = _row(self.photo)
        self.assertFalse(row.removed)
        self.assertTrue(row.in_trashcan)
        self.assertEqual(row.files.count(), 2)
        self.assertTrue(os.path.exists(self.path))
        self.assertTrue(os.path.exists(second))

    def test_a_photo_outside_the_trash_is_not_removed(self):
        photo = create_test_photo(owner=self.user)
        path = _with_file_on_disk(photo, self.user)

        with self.captureOnCommitCallbacks(execute=True):
            self.assertFalse(remove_photo(photo))

        self.assertFalse(_row(photo).removed)
        self.assertTrue(os.path.exists(path))


class EmptyTrashRestoreRaceTest(TestCase):
    def test_a_photo_restored_while_the_job_runs_keeps_its_files(self):
        user = create_test_user()
        photos = [create_test_photo(owner=user, in_trashcan=True) for _ in range(2)]
        paths = {photo.pk: _with_file_on_disk(photo, user) for photo in photos}
        real_remove = files.remove_photo
        restored = []

        def remove(photo):
            # The job listed both; the user restores the other one now.
            if not restored:
                other = next(p for p in photos if p.pk != photo.pk)
                restore_photos(Photo.objects.filter(pk=other.pk))
                restored.append(other)
            return real_remove(photo)

        job = create_test_job(user, LongRunningJob.JOB_EMPTY_TRASH)
        with (
            mock.patch.object(files, "remove_photo", side_effect=remove),
            self.captureOnCommitCallbacks(execute=True),
        ):
            empty_trash_job(user, job_id=job.job_id)

        row = _row(restored[0])
        self.assertFalse(row.removed)
        self.assertFalse(row.in_trashcan)
        self.assertTrue(os.path.exists(paths[row.pk]))
        job.refresh_from_db()
        self.assertEqual(job.result["deleted"], 1)
        self.assertFalse(job.failed)


class RestoreRemovedPhotoTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.removed = create_test_photo(owner=self.user, in_trashcan=True)
        with self.captureOnCommitCallbacks(execute=True):
            remove_photo(self.removed)

    def test_restore_photos_leaves_a_removed_photo_alone(self):
        self.assertEqual(restore_photos(Photo.objects.filter(pk=self.removed.pk)), 0)

        self.assertTrue(_row(self.removed).in_trashcan)

    def test_the_restore_endpoint_reports_a_removed_photo_as_not_restored(self):
        response = self.client.post(
            "/api/photosedit/setdeleted/",
            {"image_hashes": [self.removed.image_hash], "deleted": False},
            format="json",
        )

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json()["updated_hashes"], [])
        row = _row(self.removed)
        self.assertTrue(row.in_trashcan)
        self.assertTrue(row.removed)


class RemovedPhotoPurgeClockTest(TestCase):
    """``cleanup_deleted_photos`` counts from the removal, not the last write."""

    def setUp(self):
        self.user = create_test_user()

    def test_a_write_after_the_removal_does_not_restart_the_clock(self):
        photo = create_test_photo(owner=self.user, in_trashcan=True)
        remove_photo(photo)
        Photo.objects.filter(pk=photo.pk).update(
            removed_at=timezone.now() - timedelta(days=31),
            last_modified=timezone.now(),
        )

        cleanup_deleted_photos()

        self.assertFalse(Photo.objects.filter(pk=photo.pk).exists())

    def test_a_recent_removal_stays_however_old_the_last_write(self):
        photo = create_test_photo(owner=self.user, in_trashcan=True)
        remove_photo(photo)
        Photo.objects.filter(pk=photo.pk).update(
            last_modified=timezone.now() - timedelta(days=60)
        )

        cleanup_deleted_photos()

        self.assertTrue(Photo.objects.filter(pk=photo.pk).exists())


class PersonFaceCountFollowsTheLifecycleTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.client = APIClient()
        self.client.force_authenticate(self.user)
        self.person = create_test_person(cluster_owner=self.user)
        self.photos = [create_test_photo(owner=self.user) for _ in range(2)]
        for photo in self.photos:
            create_test_face(photo=photo, person=self.person)
        self.person._calculate_face_count()

    def face_count(self) -> int:
        return Person.objects.get(pk=self.person.pk).face_count

    def post(self, url: str, **body):
        response = self.client.post(
            url, {"image_hashes": [self.photos[0].image_hash], **body}, format="json"
        )
        self.assertEqual(response.status_code, 200)

    def test_hiding_and_unhiding_a_photo_updates_the_count(self):
        self.assertEqual(self.face_count(), 2)

        self.post("/api/photosedit/hide/", hidden=True)
        self.assertEqual(self.face_count(), 1)

        self.post("/api/photosedit/hide/", hidden=False)
        self.assertEqual(self.face_count(), 2)

    def test_trashing_and_restoring_a_photo_updates_the_count(self):
        self.post("/api/photosedit/setdeleted/", deleted=True)
        self.assertEqual(self.face_count(), 1)

        self.post("/api/photosedit/setdeleted/", deleted=False)
        self.assertEqual(self.face_count(), 2)
