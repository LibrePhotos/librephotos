"""Removing the small square thumbnails older releases made.

Up to 1.6 every photo had a 250 px square beside its 500 px one, which the grid
only showed blurred while the bigger one loaded. The ThumbHash took that over,
so the scan stopped making them and their URLs answer with the square. The
Remove Small Thumbnails job (an upgrade task, needed while their folder is
there) deletes the files and then the folder, and nothing else.
"""

import os
import tempfile
from unittest import mock

from django.test import TestCase, override_settings

from api.models import LongRunningJob
from api.models.long_running_job import JobCancelledError
from api.tests.utils import create_test_job, create_test_user
from api.thumbnails import legacy_squares
from api.thumbnails.legacy_squares import (
    legacy_squares_exist,
    remove_small_thumbnails,
    remove_small_thumbnails_job,
)


class _MediaRootTestCase(TestCase):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.media_root = folder.name
        overrider = override_settings(MEDIA_ROOT=self.media_root)
        overrider.enable()
        self.addCleanup(overrider.disable)
        self.folder = os.path.join(self.media_root, "square_thumbnails_small")
        self.square = os.path.join(self.media_root, "square_thumbnails")
        os.makedirs(self.folder)
        os.makedirs(self.square)

    def _small(self, name, size=10):
        path = os.path.join(self.folder, name)
        with open(path, "wb") as handle:
            handle.write(b"x" * size)
        return path


class RemoveSmallThumbnailsTest(_MediaRootTestCase):
    def test_every_file_and_then_the_folder_go(self):
        self._small("a.webp", 10)
        self._small("b.mp4", 25)
        square = os.path.join(self.square, "a.webp")
        with open(square, "wb") as handle:
            handle.write(b"kept")

        result = remove_small_thumbnails()

        self.assertEqual(
            (result.removed, result.freed_bytes, result.errors), (2, 35, [])
        )
        self.assertFalse(os.path.exists(self.folder))
        self.assertFalse(legacy_squares_exist())
        self.assertTrue(os.path.exists(square))

    def test_a_subdirectory_is_kept_and_so_is_the_folder(self):
        """Not something the scan made (a NAS's index folder): left alone, and
        it does not hold the task open, which an admin could never dismiss."""
        self._small("a.webp")
        inner = os.path.join(self.folder, "not ours")
        os.makedirs(inner)
        with open(os.path.join(inner, "c.webp"), "wb") as handle:
            handle.write(b"kept")

        result = remove_small_thumbnails()

        self.assertEqual(result.removed, 1)
        self.assertEqual(os.listdir(self.folder), ["not ours"])
        self.assertTrue(os.path.exists(os.path.join(inner, "c.webp")))
        self.assertFalse(legacy_squares_exist())

    def test_a_link_is_removed_without_touching_its_target(self):
        target = os.path.join(self.square, "target.webp")
        with open(target, "wb") as handle:
            handle.write(b"the square")
        link = os.path.join(self.folder, "link.webp")
        try:
            os.symlink(target, link)
        except (OSError, NotImplementedError) as error:
            self.skipTest(f"cannot make a symlink here: {error}")

        result = remove_small_thumbnails()

        self.assertEqual(result.removed, 1)
        self.assertFalse(os.path.lexists(link))
        with open(target, "rb") as handle:
            self.assertEqual(handle.read(), b"the square")

    def test_a_file_that_cannot_be_deleted_is_listed_and_keeps_the_folder(self):
        self._small("a.webp")
        locked = self._small("locked.webp")
        real_remove = os.remove

        def remove(path):
            if path == locked:
                raise PermissionError("locked")
            real_remove(path)

        with mock.patch.object(legacy_squares.os, "remove", side_effect=remove):
            result = remove_small_thumbnails()

        self.assertEqual(result.removed, 1)
        self.assertEqual(len(result.errors), 1)
        self.assertTrue(result.errors[0].startswith("locked.webp: "))
        self.assertTrue(os.path.exists(locked))
        self.assertTrue(legacy_squares_exist())

    def test_progress_is_reported_at_the_start_every_batch_and_the_end(self):
        for index in range(5):
            self._small(f"{index}.webp")
        progress = mock.Mock()

        remove_small_thumbnails(progress=progress, progress_every=2)

        self.assertEqual(
            [call.args for call in progress.call_args_list],
            [(0, 5), (2, 5), (4, 5), (5, 5)],
        )

    def test_an_empty_folder_is_removed(self):
        progress = mock.Mock()

        result = remove_small_thumbnails(progress=progress)

        self.assertEqual((result.removed, result.freed_bytes), (0, 0))
        self.assertEqual([call.args for call in progress.call_args_list], [(0, 0)])
        self.assertFalse(os.path.exists(self.folder))

    def test_a_missing_folder_is_nothing_to_do(self):
        os.rmdir(self.folder)
        progress = mock.Mock()

        result = remove_small_thumbnails(progress=progress)

        self.assertEqual(
            (result.removed, result.freed_bytes, result.errors), (0, 0, [])
        )
        progress.assert_not_called()
        self.assertTrue(os.path.isdir(self.square))


class RemoveSmallThumbnailsJobTest(_MediaRootTestCase):
    def setUp(self):
        super().setUp()
        self.user = create_test_user(is_admin=True)

    def _job(self):
        return create_test_job(self.user, LongRunningJob.JOB_REMOVE_SMALL_THUMBNAILS)

    def test_the_job_completes_with_its_counts(self):
        self._small("a.webp", 10)
        self._small("b.webp", 20)
        job = self._job()

        remove_small_thumbnails_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual(
            {key: job.result[key] for key in ("removed", "freed_bytes", "error_count")},
            {"removed": 2, "freed_bytes": 30, "error_count": 0},
        )
        self.assertEqual(job.result["errors"], [])
        self.assertEqual((job.progress_current, job.progress_target), (2, 2))
        self.assertFalse(legacy_squares_exist())

    def test_a_cancelled_job_stops(self):
        self._small("a.webp")
        job = self._job()
        with mock.patch.object(
            LongRunningJob, "stop_if_cancelled", side_effect=JobCancelledError("job")
        ):
            remove_small_thumbnails_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertFalse(job.failed)
        self.assertIsNone(job.result)
        self.assertTrue(os.path.exists(os.path.join(self.folder, "a.webp")))

    def test_an_unexpected_error_fails_the_job(self):
        job = self._job()
        with mock.patch.object(
            legacy_squares,
            "remove_small_thumbnails",
            side_effect=RuntimeError("disk gone"),
        ):
            remove_small_thumbnails_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.failed)

    def test_a_job_cancelled_while_queued_does_nothing(self):
        self._small("a.webp")
        job = self._job()
        LongRunningJob.objects.filter(pk=job.pk).update(cancelled=True, finished=True)

        remove_small_thumbnails_job(self.user, job.job_id)

        self.assertTrue(os.path.exists(os.path.join(self.folder, "a.webp")))
