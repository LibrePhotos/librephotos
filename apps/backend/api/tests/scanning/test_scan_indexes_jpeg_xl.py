"""A scan indexes JPEG XL files next to PNGs (#1491).

The report: after a database reset only the PNGs and videos of a library came
back; the JPEG XL files were seen by the scan but never became photos, because
the libvips in that image could not decode them. Thumbnails now fall back to
Pillow with pillow-jxl-plugin when libvips has no JPEG XL loader
(``api/thumbnails/decoding.py``).

This runs a real scan with real thumbnail rendering; only the exif service
and the follow-up jobs are stubbed.
"""

import os
import shutil
import tempfile
import uuid
from collections.abc import Iterator
from contextlib import ExitStack, contextmanager
from unittest.mock import patch

import pillow_jxl  # noqa: F401  registers the JPEG XL plugin with Pillow
from django.test import TestCase, override_settings
from PIL import Image

from api.directory_watcher import scan_photos
from api.models import LongRunningJob, Photo
from api.tests.scanning.test_sidecar_association_on_scan import SlowIngestQueue
from api.tests.utils import create_test_user


def no_metadata(media_file: str, tags: list[str], *args: object, **kwargs: object):
    return [None] * len(tags)


class ScanIndexesJpegXlTest(TestCase):
    def setUp(self) -> None:
        self.user = create_test_user()
        self.scan_dir = tempfile.mkdtemp(prefix="lp-1491-")
        self.media_root = tempfile.mkdtemp(prefix="lp-1491-media-")
        for directory in (self.scan_dir, self.media_root):
            self.addCleanup(shutil.rmtree, directory, True)
        self.user.scan_directory = self.scan_dir
        self.user.save(update_fields=["scan_directory"])
        # For the whole test: the thumbnail paths are checked after the scan.
        media = override_settings(MEDIA_ROOT=self.media_root)
        media.enable()
        self.addCleanup(media.disable)

    def write_image(self, name: str, size: tuple[int, int]) -> str:
        """An image of ``size``; different sizes give different file hashes."""
        path = os.path.join(self.scan_dir, name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        image = Image.new("RGB", size, (200, 40, 40))
        image.paste((40, 40, 200), (0, 0, size[0] // 2, size[1]))
        image.save(path, format="JXL" if name.lower().endswith(".jxl") else None)
        return path

    @contextmanager
    def scan_environment(self) -> Iterator[SlowIngestQueue]:
        queue = SlowIngestQueue()
        with ExitStack() as stack:
            for target in (
                "api.directory_watcher.scan_jobs._queue_followup_jobs",
                "api.directory_watcher.scan_jobs.db.connections.close_all",
                "api.directory_watcher.file_handlers.has_embedded_motion_video",
            ):
                stack.enter_context(patch(target, return_value=False))
            for target in (
                "api.metadata.photo_reader.get_metadata",
                "api.metadata.photo_datetime.get_metadata",
            ):
                stack.enter_context(patch(target, no_metadata))
            stack.enter_context(patch("api.jobs.queue.AsyncTask", queue))
            stack.enter_context(patch("django_q.tasks.count_group", queue.count_group))
            yield queue

    def scan(self) -> LongRunningJob:
        job_id = str(uuid.uuid4())
        with self.scan_environment() as queue:
            scan_photos(self.user, False, job_id)
            queue.drain()
        return LongRunningJob.objects.get(job_id=job_id)

    def test_jpeg_xl_files_become_photos_with_thumbnails(self) -> None:
        paths = [
            self.write_image("control.png", (64, 48)),
            self.write_image("holiday.jxl", (80, 40)),
            self.write_image("CAMERA.JXL", (60, 90)),
            self.write_image(os.path.join("2024", "nested.jxl"), (72, 48)),
        ]

        job = self.scan()

        self.assertEqual(0, (job.result or {}).get("error_count", 0))
        photos = Photo.objects.filter(owner=self.user).select_related(
            "main_file", "thumbnail"
        )
        self.assertEqual(sorted(paths), sorted(p.main_file.path for p in photos))
        for photo in photos:
            with self.subTest(path=photo.main_file.path):
                thumbnail = photo.thumbnail
                for field in (
                    thumbnail.thumbnail_big,
                    thumbnail.square_thumbnail,
                    thumbnail.square_thumbnail_small,
                ):
                    self.assertTrue(field and os.path.exists(field.path), field)
                self.assertIsNotNone(thumbnail.aspect_ratio)

    def test_the_thumbnail_keeps_the_aspect_ratio(self) -> None:
        self.write_image("tall.jxl", (60, 90))

        self.scan()

        photo = Photo.objects.select_related("thumbnail").get(owner=self.user)
        self.assertAlmostEqual(60 / 90, photo.thumbnail.aspect_ratio, places=2)
