"""A changed scan directory and the photos it leaves outside (#2036).

Changing a user's scan directory re-assigns nothing. The user edit dialog
asks how many of the user's photos the new folder leaves outside
(``GET /api/manage/user/<id>/scan-directory-impact/``) and can start a job
that moves them to the user's trash
(``POST /api/manage/user/<id>/trash-photos-outside-library/``). Files are
never touched, other users' photos never move.
"""

import os
from unittest.mock import patch

from django.conf import settings
from django.test import TestCase
from rest_framework.test import APIClient

from api.models import LongRunningJob, Photo
from api.models.long_running_job import JobCancelledError
from api.photos.outside_library import (
    photos_outside_library,
    trash_photos_outside_library_job,
)
from api.photos.paths import nextcloud_media_root
from api.tests.utils import (
    api_error,
    create_test_file,
    create_test_job,
    create_test_photo,
    create_test_tag,
    create_test_user,
)

# Normalised, as the scan stores the paths it walks from a saved scan directory.
ROOT = os.path.normpath(os.path.abspath(settings.DATA_ROOT))
OLD = os.path.join(ROOT, "photos", "wrong")
NEW = os.path.join(ROOT, "photos", "sam")


def photo_at(owner, *parts, **fields):
    path = os.path.join(*parts)
    return create_test_photo(
        owner=owner, main_file=create_test_file(path, owner), **fields
    )


class PhotosOutsideLibraryTest(TestCase):
    def setUp(self):
        self.sam = create_test_user(scan_directory=NEW)
        self.inside = photo_at(self.sam, NEW, "2024", "a.jpg")
        self.outside = photo_at(self.sam, OLD, "b.jpg")

    def outside_ids(self, *args):
        return set(photos_outside_library(self.sam, *args).values_list("pk", flat=True))

    def test_photos_below_the_scan_directory_are_inside(self):
        self.assertEqual(self.outside_ids(), {self.outside.pk})

    def test_a_proposed_scan_directory_counts_instead_of_the_stored_one(self):
        self.assertEqual(self.outside_ids(OLD), {self.inside.pk})
        # A parent of both holds both.
        self.assertEqual(self.outside_ids(os.path.join(ROOT, "photos")), set())

    def test_a_sibling_sharing_the_prefix_is_outside(self):
        sibling = photo_at(self.sam, NEW + "2", "c.jpg")
        self.assertIn(sibling.pk, self.outside_ids())

    def test_the_upload_folder_is_part_of_the_library(self):
        uploads = os.path.join(ROOT, "uploads", "sam")
        uploaded = photo_at(self.sam, uploads, "phone", "d.jpg")
        self.assertIn(uploaded.pk, self.outside_ids())
        self.assertNotIn(uploaded.pk, self.outside_ids(NEW, uploads))
        # The default upload folder is inside the scan directory.
        default_upload = photo_at(self.sam, NEW, "uploads", "e.jpg")
        self.assertNotIn(default_upload.pk, self.outside_ids(NEW, ""))

    def test_nextcloud_copies_are_never_outside(self):
        copy = photo_at(self.sam, nextcloud_media_root(), str(self.sam.id), "f.jpg")
        self.assertNotIn(copy.pk, self.outside_ids())

    def test_trashed_and_removed_photos_are_left_out(self):
        photo_at(self.sam, OLD, "g.jpg", in_trashcan=True)
        photo_at(self.sam, OLD, "h.jpg", removed=True)
        self.assertEqual(self.outside_ids(), {self.outside.pk})

    def test_other_users_photos_never_count(self):
        mira = create_test_user(scan_directory=OLD)
        photo_at(mira, NEW, "i.jpg")
        self.assertEqual(self.outside_ids(), {self.outside.pk})

    def test_without_a_scan_directory_nothing_is_outside(self):
        self.sam.scan_directory = ""
        self.assertEqual(self.outside_ids(), set())


class TrashPhotosOutsideLibraryJobTest(TestCase):
    def setUp(self):
        self.sam = create_test_user(scan_directory=NEW)
        self.inside = photo_at(self.sam, NEW, "a.jpg")
        self.outside = [photo_at(self.sam, OLD, f"{n}.jpg") for n in range(3)]
        self.mira = create_test_user(scan_directory=OLD)
        self.miras = photo_at(self.mira, OLD, "m.jpg")

    def run_job(self):
        job = create_test_job(self.sam, LongRunningJob.JOB_TRASH_PHOTOS_OUTSIDE_LIBRARY)
        trash_photos_outside_library_job(self.sam, job_id=job.job_id)
        job.refresh_from_db()
        return job

    def trashed(self):
        return set(Photo.objects.filter(in_trashcan=True).values_list("pk", flat=True))

    def test_moves_only_the_users_photos_outside_to_the_trash(self):
        job = self.run_job()

        self.assertEqual(self.trashed(), {photo.pk for photo in self.outside})
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(job.result["trashed_count"], 3)
        self.assertEqual((job.progress_current, job.progress_target), (3, 3))
        # Files and owners stay as they were.
        for photo in self.outside:
            photo.refresh_from_db()
            self.assertEqual(photo.owner, self.sam)
            self.assertIsNotNone(photo.trashed_at)
            self.assertTrue(os.path.basename(photo.main_file.path).endswith(".jpg"))

    def test_refreshes_the_tag_counts(self):
        tag = create_test_tag(self.sam)
        tag.photos.add(self.inside, self.outside[0])
        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 2)

        self.run_job()

        tag.refresh_from_db()
        self.assertEqual(tag.photo_count, 1)

    def test_works_in_steps_and_stops_on_cancel(self):
        with (
            patch("api.photos.outside_library.BATCH_SIZE", 2),
            patch.object(
                LongRunningJob,
                "stop_if_cancelled",
                side_effect=JobCancelledError("job"),
            ),
        ):
            job = self.run_job()

        # The first step of two photos went through, then the cancel stopped it.
        self.assertEqual(len(self.trashed()), 2)
        self.assertEqual(job.progress_current, 2)

    def test_a_job_cancelled_while_queued_does_nothing(self):
        job = create_test_job(self.sam, LongRunningJob.JOB_TRASH_PHOTOS_OUTSIDE_LIBRARY)
        job.cancel()

        trash_photos_outside_library_job(self.sam, job_id=job.job_id)

        self.assertEqual(self.trashed(), set())


class ScanDirectoryImpactViewTest(TestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.sam = create_test_user(scan_directory=OLD)
        photo_at(self.sam, OLD, "a.jpg")
        photo_at(self.sam, OLD, "b.jpg")
        photo_at(self.sam, NEW, "c.jpg")
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def get(self, user_id, **query):
        return self.client.get(
            f"/api/manage/user/{user_id}/scan-directory-impact/", query
        )

    def test_counts_the_photos_a_new_folder_leaves_outside(self):
        response = self.get(self.sam.id, scan_directory=NEW)

        self.assertEqual(response.status_code, 200)
        self.assertEqual(response.json(), {"outside_count": 2})
        self.assertEqual(
            self.get(self.sam.id, scan_directory=OLD).json(), {"outside_count": 1}
        )

    def test_changes_nothing(self):
        self.get(self.sam.id, scan_directory=NEW)

        self.sam.refresh_from_db()
        self.assertEqual(self.sam.scan_directory, OLD)
        self.assertFalse(Photo.objects.filter(in_trashcan=True).exists())

    def test_a_folder_outside_the_data_root_is_400(self):
        response = self.get(self.sam.id, scan_directory=os.path.dirname(ROOT))

        self.assertEqual(response.status_code, 400)
        self.assertEqual(api_error(response)["field"], "scan_directory")

    def test_scan_directory_is_required(self):
        self.assertEqual(self.get(self.sam.id).status_code, 400)

    def test_unknown_user_is_404(self):
        self.assertEqual(
            self.get(self.sam.id + 1000, scan_directory=NEW).status_code, 404
        )

    def test_only_admins(self):
        self.client.force_authenticate(user=self.sam)
        self.assertEqual(self.get(self.sam.id, scan_directory=NEW).status_code, 403)


class TrashPhotosOutsideLibraryViewTest(TestCase):
    def setUp(self):
        self.admin = create_test_user(is_admin=True)
        self.sam = create_test_user(scan_directory=NEW)
        self.client = APIClient()
        self.client.force_authenticate(user=self.admin)

    def post(self, user_id):
        with patch("api.jobs.queue.AsyncTask") as task:
            with self.captureOnCommitCallbacks(execute=True):
                response = self.client.post(
                    f"/api/manage/user/{user_id}/trash-photos-outside-library/"
                )
        self.task = task
        return response

    def test_starts_the_job_as_the_user(self):
        response = self.post(self.sam.id)

        self.assertEqual(response.status_code, 200)
        job = LongRunningJob.objects.get(job_id=response.json()["job_id"])
        self.assertEqual(job.started_by, self.sam)
        self.assertEqual(job.job_type, LongRunningJob.JOB_TRASH_PHOTOS_OUTSIDE_LIBRARY)
        args = self.task.call_args.args
        self.assertIs(args[0], trash_photos_outside_library_job)
        self.assertEqual(args[1], self.sam)

    def test_a_second_start_while_one_runs_is_409(self):
        create_test_job(self.sam, LongRunningJob.JOB_TRASH_PHOTOS_OUTSIDE_LIBRARY)

        response = self.post(self.sam.id)

        self.assertEqual(response.status_code, 409)

    def test_only_admins(self):
        self.client.force_authenticate(user=self.sam)

        self.assertEqual(self.post(self.sam.id).status_code, 403)
        self.assertFalse(LongRunningJob.objects.exists())

    def test_unknown_user_is_404(self):
        self.assertEqual(self.post(self.sam.id + 1000).status_code, 404)
