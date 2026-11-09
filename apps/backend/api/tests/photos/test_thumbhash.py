"""The grid's placeholders: a ThumbHash per photo instead of a small thumbnail.

A tile used to load a 250 px thumbnail, blurred, before its grid thumbnail:
two requests through the media view per tile. The scan now stores a ThumbHash
(~25 bytes) beside the dominant colour, the grid serializers send it, the web
app decodes it, and the Make Photo Placeholders job (an upgrade task) gives
the photos scanned before theirs.
"""

import base64
import importlib
import os
import tempfile
from unittest import mock

import numpy as np
from django.apps import apps as global_apps
from django.test import TestCase, override_settings
from PIL import Image

from api.models import LongRunningJob, Thumbnail, UpgradeTaskState
from api.models.long_running_job import JobCancelledError
from api.serializers.photos import PhotoSummarySerializer, with_photo_summary_relations
from api.serializers.simple import PhotoSimpleSerializer
from api.tests.utils import create_test_job, create_test_photo, create_test_user
from api.thumbnails import placeholders, render
from api.thumbnails.thumbhash import rgba_to_thumbhash, thumbhash_of_file

migration_0225 = importlib.import_module("api.migrations.0225_thumbhash")


def _opaque(rgb):
    return np.dstack([rgb, np.full(rgb.shape[:2], 255)]).astype(np.uint8)


def _gradient():
    yy, xx = np.mgrid[0:60, 0:100]
    return _opaque(np.dstack([xx * 2.5, yy * 4, 255 - xx * 2]))


def _portrait():
    yy, xx = np.mgrid[0:60, 0:45]
    wave = np.sin(yy / 7 + xx / 9) * 120 + 128
    return _opaque(np.dstack([wave] * 3).repeat(2, 0)[:100])


def _circle():
    yy, xx = np.mgrid[0:40, 0:40]
    alpha = np.where((xx - 20) ** 2 + (yy - 20) ** 2 < 300, 255, 0)
    return np.dstack([np.full((40, 40), 200), xx * 6, yy * 6, alpha]).astype(np.uint8)


# What the reference encoder (the web app's ``thumbhash`` package,
# ``rgbaToThumbHash``) makes of the same pixels.
REFERENCE = {
    "landscape": (_gradient, "4QYKhJqGh4eAh4iHiHeAdQj4iA=="),
    "portrait": (_portrait, "IAgSAwB5lZtfand4AAAAAAA="),
    "transparent": (_circle, "JJmGJQg5gIyAe7jHh4R/93d3B1eHiIB3WA=="),
    "one pixel": (
        lambda: np.array([[[10, 200, 30, 255]]], dtype=np.uint8),
        "VIoon14I9wiIh4hwj3CI+AiIgIAI94cP",
    ),
}


class EncoderTest(TestCase):
    def test_it_makes_the_reference_encoders_bytes(self):
        for name, (pixels, expected) in REFERENCE.items():
            with self.subTest(name):
                encoded = base64.b64encode(rgba_to_thumbhash(pixels())).decode()
                self.assertEqual(encoded, expected)

    def test_a_picture_over_100_pixels_is_refused(self):
        with self.assertRaises(ValueError):
            rgba_to_thumbhash(np.zeros((60, 101, 4), dtype=np.uint8))

    def test_a_file_is_shrunk_into_the_box_first(self):
        with tempfile.TemporaryDirectory() as folder:
            path = os.path.join(folder, "big.webp")
            Image.new("RGB", (400, 250), (30, 120, 200)).save(path)
            encoded = thumbhash_of_file(path)

        raw = base64.b64decode(encoded)
        # Opaque and landscape: 5 header bytes and the low "has alpha" bit unset.
        self.assertGreater(len(raw), 5)
        self.assertFalse(raw[2] & 0x80)
        self.assertTrue(raw[4] & 0x80)

    def test_a_missing_file_raises(self):
        with self.assertRaises(OSError):
            thumbhash_of_file("/nowhere/at/all.webp")


class _MediaRootTestCase(TestCase):
    def setUp(self):
        super().setUp()
        folder = tempfile.TemporaryDirectory()
        self.addCleanup(folder.cleanup)
        self.media_root = folder.name
        overrider = override_settings(MEDIA_ROOT=self.media_root)
        overrider.enable()
        self.addCleanup(overrider.disable)
        for directory in ("thumbnails_big", "square_thumbnails_small"):
            os.makedirs(os.path.join(self.media_root, directory))
        self.user = create_test_user()

    def _photo(self, readable=True, video=False):
        """A photo whose small square (a video: its big thumbnail) is a picture, or is missing."""
        photo = create_test_photo(owner=self.user, video=video)
        if readable:
            directory = "thumbnails_big" if video else "square_thumbnails_small"
            Image.new("RGB", (40, 25), (200, 60, 20)).save(
                os.path.join(self.media_root, directory, photo.image_hash + ".webp")
            )
        if not video:
            Thumbnail.objects.filter(photo=photo).update(
                square_thumbnail_small=f"square_thumbnails_small/{photo.image_hash}.webp"
            )
        return Thumbnail.objects.get(photo=photo)


class ScanTest(_MediaRootTestCase):
    def test_a_photo_gets_its_thumbhash_from_the_small_square(self):
        thumbnail = self._photo()
        render.calculate_thumbhash(thumbnail)

        thumbnail.refresh_from_db()
        self.assertIsNotNone(thumbnail.thumbhash)
        self.assertEqual(
            thumbnail.thumbhash,
            thumbhash_of_file(thumbnail.square_thumbnail_small.path),
        )

    def test_a_video_gets_it_from_its_big_thumbnail(self):
        thumbnail = self._photo(video=True)
        render.calculate_thumbhash(thumbnail)

        thumbnail.refresh_from_db()
        self.assertEqual(
            thumbnail.thumbhash, thumbhash_of_file(thumbnail.thumbnail_big.path)
        )

    def test_one_already_stored_is_kept(self):
        thumbnail = self._photo()
        Thumbnail.objects.filter(pk=thumbnail.pk).update(thumbhash="kept")
        thumbnail.refresh_from_db()
        render.calculate_thumbhash(thumbnail)

        thumbnail.refresh_from_db()
        self.assertEqual(thumbnail.thumbhash, "kept")

    def test_a_rebuilt_thumbnail_samples_it_again(self):
        thumbnail = self._photo()
        thumbnail.thumbhash = "the old picture"
        render.refresh_thumbhash(thumbnail)

        thumbnail.refresh_from_db()
        self.assertNotEqual(thumbnail.thumbhash, "the old picture")

    def test_an_unreadable_thumbnail_leaves_none(self):
        thumbnail = self._photo(readable=False)
        thumbnail.thumbhash = "the old picture"
        render.refresh_thumbhash(thumbnail)

        thumbnail.refresh_from_db()
        self.assertIsNone(thumbnail.thumbhash)

    def test_the_dominant_colour_still_comes_from_the_same_picture(self):
        thumbnail = self._photo()
        render.calculate_dominant_color(thumbnail)

        thumbnail.refresh_from_db()
        # A lossy WebP of (200, 60, 20): within a step of it.
        red, green, blue = (int(x) for x in thumbnail.dominant_color[1:-1].split(", "))
        self.assertLessEqual(abs(red - 200) + abs(green - 60) + abs(blue - 20), 3)


class MakeThumbhashesTest(_MediaRootTestCase):
    def test_every_photo_without_one_gets_one_in_batches(self):
        readable = [self._photo() for _ in range(3)]
        self._photo(readable=False)
        progress = mock.Mock()

        result = placeholders.make_thumbhashes(progress=progress, batch_size=2)

        self.assertEqual((result.made, result.skipped), (3, 1))
        for thumbnail in readable:
            thumbnail.refresh_from_db()
            self.assertIsNotNone(thumbnail.thumbhash)
        self.assertEqual(
            [call.args for call in progress.call_args_list], [(0, 4), (2, 4), (4, 4)]
        )

    def test_photos_that_have_one_are_left_alone(self):
        done = self._photo()
        Thumbnail.objects.filter(pk=done.pk).update(thumbhash="kept")

        result = placeholders.make_thumbhashes()

        done.refresh_from_db()
        self.assertEqual(done.thumbhash, "kept")
        self.assertEqual((result.made, result.skipped), (0, 0))

    def test_the_job_completes_with_its_counts(self):
        self._photo()
        self._photo(readable=False)
        job = create_test_job(self.user, LongRunningJob.JOB_MAKE_THUMBHASHES)

        placeholders.make_thumbhashes_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        self.assertEqual((job.result["made"], job.result["skipped"]), (1, 1))
        self.assertEqual((job.progress_current, job.progress_target), (2, 2))

    def test_a_cancelled_job_stops(self):
        self._photo()
        job = create_test_job(self.user, LongRunningJob.JOB_MAKE_THUMBHASHES)
        with mock.patch.object(
            LongRunningJob, "stop_if_cancelled", side_effect=JobCancelledError("job")
        ):
            placeholders.make_thumbhashes_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertFalse(job.failed)
        self.assertIsNone(job.result)

    def test_an_unexpected_error_fails_the_job(self):
        job = create_test_job(self.user, LongRunningJob.JOB_MAKE_THUMBHASHES)
        with mock.patch.object(
            placeholders, "make_thumbhashes", side_effect=RuntimeError("database gone")
        ):
            placeholders.make_thumbhashes_job(self.user, job.job_id)

        job.refresh_from_db()
        self.assertTrue(job.failed)


class SerializerTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self.photo = create_test_photo(owner=self.user)
        Thumbnail.objects.filter(photo=self.photo).update(thumbhash="4QYKhJqG")

    def _row(self):
        return with_photo_summary_relations(type(self.photo).objects).get(
            pk=self.photo.pk
        )

    def test_the_grid_rows_carry_it(self):
        photo = self._row()
        self.assertEqual(PhotoSummarySerializer(photo).data["thumbhash"], "4QYKhJqG")
        self.assertEqual(PhotoSimpleSerializer(photo).data["thumbhash"], "4QYKhJqG")

    def test_a_photo_scanned_before_sends_null(self):
        Thumbnail.objects.filter(photo=self.photo).update(thumbhash=None)
        self.assertIsNone(PhotoSummarySerializer(self._row()).data["thumbhash"])


class SeedingTest(TestCase):
    """Migration 0225: the placeholder task only where there are thumbnails."""

    def seed(self):
        migration_0225.seed_upgrade_task(global_apps, None)
        return set(UpgradeTaskState.objects.values_list("key", flat=True))

    def test_a_fresh_database_gets_no_row(self):
        self.assertEqual(self.seed(), set())

    def test_photos_seed_the_placeholders(self):
        create_test_photo(owner=create_test_user())
        self.assertEqual(self.seed(), {"make_thumbhashes"})
        self.assertEqual(self.seed(), {"make_thumbhashes"})
