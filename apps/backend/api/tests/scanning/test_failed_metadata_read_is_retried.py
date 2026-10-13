"""A photo whose metadata read failed is read again by the next scan (#2271).

When the exif service cannot answer for a file (restarting, a hung ExifTool,
a 500), ``get_metadata`` raises and the scan records the file as failed. The
photo row and its thumbnails exist by then, so an incremental scan used to
take the file as known and unchanged and never read it again.
"""

import os
import shutil
import tempfile
import time
import uuid
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from unittest.mock import patch

from django.test import TestCase, override_settings

from api.directory_watcher import scan_photos
from api.directory_watcher.file_handlers import handle_new_image
from api.metadata.reader import MetadataReadError
from api.models import LongRunningJob, Photo
from api.tests.scanning.test_sidecar_association_on_scan import (
    SlowIngestQueue,
    create_unique_png,
)
from api.tests.utils import create_test_job, create_test_user


class FailedMetadataReadIsRetriedTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.scan_dir = tempfile.mkdtemp(prefix="lp-2271-")
        self.media_root = tempfile.mkdtemp(prefix="lp-2271-media-")
        for directory in (self.scan_dir, self.media_root):
            self.addCleanup(shutil.rmtree, directory, True)
        self.user.scan_directory = self.scan_dir
        self.user.save(update_fields=["scan_directory"])
        self.paths = []
        for index in range(3):
            path = os.path.join(self.scan_dir, f"img_{index}.png")
            with open(path, "wb") as handle:
                handle.write(create_unique_png(index))
            # Well before the first scan finishes, whatever the machine's zone.
            os.utime(path, (time.time() - 86400, time.time() - 86400))
            self.paths.append(path)
        self.failing = {self.paths[1]}
        # The main-file path of every scan-time metadata read, in order.
        self.reads: list[str] = []

    def fake_get_metadata(
        self, media_file: str, tags: list[str], *args: object, **kwargs: object
    ) -> list[object]:
        self.reads.append(media_file)
        if media_file in self.failing:
            raise MetadataReadError(
                f"exif service could not read the metadata of {media_file}"
            )
        return [None] * len(tags)

    @contextmanager
    def scan_environment(self) -> Iterator[SlowIngestQueue]:
        queue = SlowIngestQueue()
        with ExitStack() as stack:
            for target in (
                "api.thumbnails.decoding.thumbnail",
                "api.thumbnails.render.generate_thumbnail",
                "api.thumbnails.render.calculate_aspect_ratio",
                "api.thumbnails.render.calculate_dominant_color",
                "api.directory_watcher.scan_jobs._queue_followup_jobs",
                "api.directory_watcher.scan_jobs.db.connections.close_all",
                "api.directory_watcher.file_handlers.has_embedded_motion_video",
            ):
                stack.enter_context(patch(target, return_value=False))
            for target in (
                "api.metadata.photo_reader.get_metadata",
                "api.metadata.photo_datetime.get_metadata",
            ):
                stack.enter_context(patch(target, self.fake_get_metadata))
            stack.enter_context(patch("api.jobs.queue.AsyncTask", queue))
            stack.enter_context(patch("django_q.tasks.count_group", queue.count_group))
            stack.enter_context(override_settings(MEDIA_ROOT=self.media_root))
            yield queue

    def scan(self) -> LongRunningJob:
        job_id = str(uuid.uuid4())
        with self.scan_environment() as queue:
            scan_photos(self.user, False, job_id)
            queue.drain()
        return LongRunningJob.objects.get(job_id=job_id)

    def read_at(self, path: str) -> object:
        return Photo.objects.get(main_file__path=path).metadata_read_at

    def test_the_next_incremental_scan_reads_the_failed_file_again(self) -> None:
        first = self.scan()

        self.assertEqual(1, (first.result or {}).get("error_count"))
        self.assertEqual(3, Photo.objects.filter(owner=self.user).count())

        # The exif service is back; nothing on disk changed.
        self.failing = set()
        self.reads = []
        self.scan()

        # Only the photo whose read failed is read again, once per reader.
        self.assertEqual({self.paths[1]}, set(self.reads))

    def test_a_failed_read_leaves_the_photo_unread_until_a_scan_reads_it(
        self,
    ) -> None:
        self.scan()

        self.assertIsNotNone(self.read_at(self.paths[0]))
        self.assertIsNone(self.read_at(self.paths[1]))
        self.assertIsNotNone(self.read_at(self.paths[2]))

        self.failing = set()
        self.scan()

        self.assertIsNotNone(self.read_at(self.paths[1]))

    def test_a_file_that_keeps_failing_is_retried_by_every_scan(self) -> None:
        self.scan()
        self.reads = []
        self.scan()
        self.assertEqual({self.paths[1]}, set(self.reads))
        self.assertIsNone(self.read_at(self.paths[1]))

    def test_a_reprocessed_photo_whose_read_fails_is_unread_again(self) -> None:
        self.failing = set()
        self.scan()
        self.assertIsNotNone(self.read_at(self.paths[0]))

        # A full rescan while the exif service is down.
        self.failing = {self.paths[0]}
        job_id = str(uuid.uuid4())
        with self.scan_environment() as queue:
            scan_photos(self.user, True, job_id)
            queue.drain()

        self.assertIsNone(self.read_at(self.paths[0]))

    def test_an_upload_is_marked_read(self) -> None:
        job = create_test_job(
            started_by=self.user,
            job_type=LongRunningJob.JOB_SCAN_PHOTOS,
            progress_target=1,
        )
        path = os.path.join(self.scan_dir, "upload.png")
        with open(path, "wb") as handle:
            handle.write(create_unique_png(42))

        with self.scan_environment():
            handle_new_image(self.user, path, job.job_id)

        self.assertIsNotNone(self.read_at(path))
