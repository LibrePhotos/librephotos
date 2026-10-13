"""Admins remove photo details from old thumbnails from the web app (#2321).

1.3.0 asked every admin upgrading from 1.2.1 or older to run
``manage.py strip_thumbnail_metadata`` in a terminal, which a Windows
standalone install only offers through ``librephotos.exe manage``. The same
work is now a job an admin starts from Admin Area > Admin Tools, with its
progress and outcome on the job's row.
"""

import json
import os
import shutil
import tempfile
from unittest import mock

from django.test import TestCase, override_settings
from rest_framework.test import APIClient

from api.models import LongRunningJob
from api.runtime import binaries
from api.tests.photos.test_thumbnail_metadata import ALL_SIZES, _gps_jpeg, _leaky_webp
from api.tests.utils import api_error, create_test_job, create_test_user
from api.thumbnails import metadata
from api.thumbnails.metadata import (
    strip_thumbnail_metadata,
    strip_thumbnail_metadata_job,
    webp_has_metadata,
)
from api.thumbnails.render import create_static_thumbnails

URL = "/api/strip-thumbnail-metadata/"


class LeakyThumbnailsTestCase(TestCase):
    """Three thumbnails written with the photo's GPS and XMP, one written clean."""

    def setUp(self):
        self.media = tempfile.mkdtemp(prefix="librephotos-stripjob")
        self.addCleanup(shutil.rmtree, self.media, True)
        settings = override_settings(MEDIA_ROOT=self.media)
        settings.enable()
        self.addCleanup(settings.disable)
        for directory in ALL_SIZES:
            os.makedirs(os.path.join(self.media, directory))
            _leaky_webp(self.path(directory))
        source = os.path.join(self.media, "photo.jpg")
        _gps_jpeg(source)
        create_static_thumbnails(source, "clean", ["thumbnails_big"])
        os.remove(source)
        self.admin = create_test_user(is_admin=True)

    def path(self, directory, name="h.webp"):
        return os.path.join(self.media, directory, name)

    def run_job(self):
        job = create_test_job(self.admin, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)
        strip_thumbnail_metadata_job(self.admin, job_id=job.job_id)
        job.refresh_from_db()
        return job


class ProgressTest(LeakyThumbnailsTestCase):
    def test_reports_thumbnails_checked_out_of_all_of_them(self):
        calls = []
        strip_thumbnail_metadata(
            progress=lambda done, total: calls.append((done, total)),
            progress_every=3,
        )
        self.assertEqual(calls, [(0, 4), (3, 4), (4, 4)])

    def test_an_empty_library_reports_nothing_to_do(self):
        calls = []
        empty = tempfile.mkdtemp(prefix="librephotos-stripjob-empty")
        self.addCleanup(shutil.rmtree, empty, True)
        strip_thumbnail_metadata(
            empty, progress=lambda done, total: calls.append((done, total))
        )
        self.assertEqual(calls, [(0, 0)])


class StripThumbnailMetadataJobTest(LeakyThumbnailsTestCase):
    def test_strips_records_progress_and_completes(self):
        job = self.run_job()

        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual((job.progress_current, job.progress_target), (4, 4))
        self.assertIsNotNone(job.last_progress_at)
        self.assertEqual(job.result["status"], "completed")
        self.assertEqual(job.result["scanned"], 4)
        self.assertEqual(job.result["stripped"], 3)
        self.assertEqual(job.result["errors"], [])
        for directory in ALL_SIZES:
            self.assertFalse(webp_has_metadata(self.path(directory)))

    def test_a_second_run_strips_nothing(self):
        self.run_job()

        again = self.run_job()

        self.assertFalse(again.failed)
        self.assertEqual(again.result["stripped"], 0)
        self.assertEqual(again.result["with_metadata"], 0)

    def test_a_job_cancelled_while_queued_does_nothing(self):
        job = create_test_job(self.admin, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)
        job.cancel()

        strip_thumbnail_metadata_job(self.admin, job_id=job.job_id)

        self.assertTrue(webp_has_metadata(self.path("thumbnails_big")))

    def test_a_cancel_stops_the_walk(self):
        job = create_test_job(self.admin, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)

        update = LongRunningJob.update_progress

        def update_then_cancel(row, current, target=None, step=None):
            # An admin presses Cancel while the job reports its first progress.
            update(row, current, target, step)
            LongRunningJob.objects.get(pk=row.pk).cancel()

        with mock.patch.object(
            LongRunningJob,
            "update_progress",
            autospec=True,
            side_effect=update_then_cancel,
        ):
            strip_thumbnail_metadata_job(self.admin, job_id=job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.cancelled)
        self.assertFalse(job.failed)
        self.assertEqual(job.result, {"status": "cancelled"})
        for directory in ALL_SIZES:
            self.assertTrue(webp_has_metadata(self.path(directory)))

    def test_a_failed_exiftool_batch_fails_the_job_with_the_summary(self):
        video = self.path("square_thumbnails", "v.mp4")
        with open(video, "wb") as handle:
            handle.write(b"not really a video")

        def exiftool(arguments, paths):
            if "-overwrite_original" in arguments:
                raise binaries.ToolError("exiftool", "exiftool exit 1")
            located = [
                {"SourceFile": path, "UserData:LocationInformation": "+48.8"}
                for path in paths
            ]
            return 0, json.dumps(located), ""

        with mock.patch.object(metadata, "_exiftool", side_effect=exiftool):
            job = self.run_job()

        self.assertTrue(job.failed)
        self.assertEqual(
            job.result["error"],
            "Stripped 3 thumbnails. 1 still carry metadata, 1 error.",
        )
        self.assertEqual(job.result["error_count"], 2)
        self.assertIn("exiftool exit 1", job.result["errors"])
        self.assertIn(
            f"{os.path.normpath(video)}: still carries metadata",
            job.result["errors"],
        )

    def test_exiftool_that_cannot_start_fails_the_job(self):
        with open(self.path("square_thumbnails", "v.mp4"), "wb") as handle:
            handle.write(b"not really a video")

        with (
            mock.patch.object(
                metadata,
                "_exiftool",
                side_effect=binaries.ToolMissingError("exiftool", "not found"),
            ),
            self.assertLogs("api.thumbnails.metadata", "ERROR"),
        ):
            job = self.run_job()

        self.assertTrue(job.failed)
        self.assertEqual(
            job.result["error"], "exiftool could not be started: not found"
        )


class StripThumbnailMetadataViewTest(TestCase):
    def setUp(self):
        self.client = APIClient()

    def test_an_admin_starts_the_job(self):
        admin = create_test_user(is_admin=True)
        self.client.force_authenticate(user=admin)
        with (
            mock.patch("api.jobs.queue.AsyncTask") as async_task,
            self.captureOnCommitCallbacks(execute=True),
        ):
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 200)
        job_id = response.json()["job_id"]
        self.assertEqual(response.json()["job_ids"], [job_id])
        job = LongRunningJob.objects.get(job_id=job_id)
        self.assertEqual(job.job_type, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)
        self.assertEqual(job.started_by, admin)
        self.assertEqual(
            async_task.call_args.args, (strip_thumbnail_metadata_job, admin)
        )
        self.assertEqual(async_task.call_args.kwargs["job_id"], job_id)

    def test_a_second_start_while_it_runs_is_refused(self):
        admin = create_test_user(is_admin=True)
        running = create_test_job(admin, LongRunningJob.JOB_STRIP_THUMBNAIL_METADATA)
        self.client.force_authenticate(user=admin)

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 409)
        self.assertEqual(api_error(response)["code"], "job_already_running")
        self.assertIn(running.job_id, json.dumps(response.json()))
        async_task.assert_not_called()

    def test_a_normal_user_may_not_start_it(self):
        self.client.force_authenticate(user=create_test_user())

        with mock.patch("api.jobs.queue.AsyncTask") as async_task:
            response = self.client.post(URL)

        self.assertEqual(response.status_code, 403)
        self.assertFalse(LongRunningJob.objects.exists())
        async_task.assert_not_called()

    def test_an_anonymous_request_is_refused(self):
        response = self.client.post(URL)

        self.assertEqual(response.status_code, 401)
        self.assertFalse(LongRunningJob.objects.exists())
