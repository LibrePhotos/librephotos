"""Media-category detection: screenshot classification, the scan-time hook and
the backfill job.

The pure classifier (:func:`api.screenshot_detection.classify`) is exercised
with lightweight namespace stand-ins so every filename/locale/metadata branch is
covered without touching the DB. The scan-time hook and the ``classify_media``
backfill job are covered with real ``Photo`` rows.
"""

import datetime
import os
import uuid
from types import SimpleNamespace
from unittest.mock import patch

from django.test import SimpleTestCase, TestCase

from api.directory_watcher.file_handlers import _process_photo
from api.directory_watcher.processing_jobs import classify_media
from api.models import LongRunningJob
from api.screenshot_detection import classify
from api.tests.utils import (
    ONE_PIXEL_PNG,
    create_test_file,
    create_test_photo,
    create_test_user,
)


def _meta(**overrides):
    """Build a PhotoMetadata stand-in with everything absent by default."""
    fields = dict(
        camera_model=None,
        aperture=None,
        iso=None,
        focal_length=None,
        gps_latitude=None,
        gps_longitude=None,
    )
    fields.update(overrides)
    return SimpleNamespace(**fields)


def _photo(path, metadata=None, exif_gps_lat=None, exif_gps_lon=None):
    return SimpleNamespace(
        main_file=SimpleNamespace(path=path),
        metadata=metadata,
        exif_gps_lat=exif_gps_lat,
        exif_gps_lon=exif_gps_lon,
    )


class ScreenshotClassifyRule1Test(SimpleTestCase):
    """Rule 1 — path / filename patterns (primary)."""

    def test_english_screenshot_prefix(self):
        self.assertTrue(classify(_photo("/a/Screenshot_2020-01-01.png")))

    def test_macos_screen_shot_prefix(self):
        self.assertTrue(classify(_photo("/a/Screen Shot 2020-01-01 at 10.00.00.png")))

    def test_german_prefix(self):
        self.assertTrue(classify(_photo("/a/Bildschirmfoto 2020-01-01.png")))

    def test_spanish_prefix(self):
        self.assertTrue(classify(_photo("/a/Captura de pantalla 2020-01-01.png")))

    def test_french_prefix_curly_apostrophe(self):
        self.assertTrue(classify(_photo("/a/Capture d’écran 2020.png")))

    def test_french_prefix_straight_apostrophe(self):
        self.assertTrue(classify(_photo("/a/Capture d'écran 2020.png")))

    def test_russian_prefix(self):
        self.assertTrue(classify(_photo("/a/Снимок экрана 2020.png")))

    def test_japanese_prefix(self):
        self.assertTrue(classify(_photo("/a/スクリーンショット 2020.png")))

    def test_case_insensitive_and_dash_separator(self):
        self.assertTrue(classify(_photo("/a/screenshot-1.png")))

    def test_bare_prefix_with_extension(self):
        self.assertTrue(classify(_photo("/a/Screenshot.png")))

    def test_prefix_wins_even_for_jpeg_with_camera(self):
        # Rule 1 is filename-based and applies regardless of type/metadata.
        self.assertTrue(
            classify(
                _photo("/a/Screenshot_2020.jpg", metadata=_meta(camera_model="Canon"))
            )
        )

    def test_screenshots_parent_directory(self):
        # A camera-named JPEG that merely lives in a Screenshots/ folder.
        self.assertTrue(
            classify(
                _photo(
                    "/home/u/Screenshots/IMG_1234.jpg",
                    metadata=_meta(camera_model="Canon"),
                )
            )
        )

    def test_screenshots_parent_directory_case_insensitive(self):
        self.assertTrue(classify(_photo("/home/u/screenshots/IMG_1234.jpg")))

    def test_screenshots_backslash_path(self):
        self.assertTrue(classify(_photo("C:\\Users\\u\\Screenshots\\IMG_1234.jpg")))

    def test_prefix_boundary_rejects_word_continuation(self):
        # "screenshotly" is not a screenshot; a JPEG so Rule 2 cannot rescue it.
        self.assertFalse(classify(_photo("/a/screenshotly.jpg")))


class ScreenshotClassifyRule2Test(SimpleTestCase):
    """Rule 2 — metadata-absence fallback (secondary, PNG only)."""

    def test_png_without_camera_metadata_is_screenshot(self):
        self.assertTrue(classify(_photo("/a/random.png", metadata=_meta())))

    def test_png_without_any_metadata_row_is_screenshot(self):
        self.assertTrue(classify(_photo("/a/random.png", metadata=None)))

    def test_png_with_camera_model_is_not_screenshot(self):
        self.assertFalse(
            classify(_photo("/a/random.png", metadata=_meta(camera_model="NIKON")))
        )

    def test_png_with_aperture_is_not_screenshot(self):
        self.assertFalse(
            classify(_photo("/a/random.png", metadata=_meta(aperture=2.8)))
        )

    def test_png_with_iso_is_not_screenshot(self):
        self.assertFalse(classify(_photo("/a/random.png", metadata=_meta(iso=100))))

    def test_png_with_focal_length_is_not_screenshot(self):
        self.assertFalse(
            classify(_photo("/a/random.png", metadata=_meta(focal_length=35.0)))
        )

    def test_png_with_metadata_gps_is_not_screenshot(self):
        self.assertFalse(
            classify(
                _photo(
                    "/a/random.png",
                    metadata=_meta(gps_latitude=52.5, gps_longitude=13.4),
                )
            )
        )

    def test_png_with_photo_gps_is_not_screenshot(self):
        self.assertFalse(
            classify(
                _photo(
                    "/a/random.png",
                    metadata=_meta(),
                    exif_gps_lat=52.5,
                    exif_gps_lon=13.4,
                )
            )
        )

    def test_whatsapp_jpeg_is_not_screenshot(self):
        # Stripped EXIF but a JPEG, not a PNG -> must NOT match.
        self.assertFalse(classify(_photo("/a/IMG-20200101-WA0001.jpg", metadata=None)))

    def test_normal_camera_jpeg_is_not_screenshot(self):
        self.assertFalse(
            classify(_photo("/a/IMG_1234.jpg", metadata=_meta(camera_model="SONY")))
        )


class ScanTimeHookTest(TestCase):
    """The scan-time hook in ``_process_photo`` sets ``is_screenshot`` but never
    overrides a manual ``category_source == "user"`` correction."""

    def setUp(self):
        self.user = create_test_user()
        self.job_id = uuid.uuid4()

    def _run_process(self, photo):
        with (
            patch("api.models.thumbnail.Thumbnail._generate_thumbnail"),
            patch("api.models.thumbnail.Thumbnail._calculate_aspect_ratio"),
            patch("api.models.thumbnail.Thumbnail._get_dominant_color"),
            patch("api.models.photo_search.PhotoSearch.recreate_search_captions"),
        ):
            _process_photo(
                photo, photo.main_file.path, self.job_id, datetime.datetime.now()
            )

    def test_auto_photo_marked_screenshot(self):
        # Default test photo is a PNG with no camera metadata -> Rule 2 hit.
        photo = create_test_photo(owner=self.user)
        self.assertFalse(photo.is_screenshot)
        self._run_process(photo)
        photo.refresh_from_db()
        self.assertTrue(photo.is_screenshot)
        self.assertEqual(photo.category_source, "auto")

    def test_user_corrected_photo_untouched(self):
        photo = create_test_photo(
            owner=self.user, category_source="user", is_screenshot=False
        )
        self._run_process(photo)
        photo.refresh_from_db()
        # Rule 2 would have marked it, but the user correction is respected.
        self.assertFalse(photo.is_screenshot)


class ClassifyMediaBackfillJobTest(TestCase):
    """The ``classify_media`` backfill job categorises photos, skips user
    corrections and keeps correct job bookkeeping."""

    def setUp(self):
        self.user = create_test_user()

    def _photo_with_path(self, path, content_salt, **kwargs):
        """Create a photo whose main_file lives at *path*."""
        photo = create_test_photo(owner=self.user, **kwargs)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        new_file = create_test_file(path, self.user, ONE_PIXEL_PNG + content_salt)
        photo.main_file = new_file
        photo.save()
        return photo

    def test_backfill_categorises_and_reports(self):
        # Three auto PNGs with no camera metadata -> should become screenshots.
        screenshots = [create_test_photo(owner=self.user) for _ in range(3)]
        # An auto photo with camera metadata -> stays non-screenshot.
        camera_photo = create_test_photo(owner=self.user, camera_model="Canon EOS")
        # A user-corrected photo -> excluded/untouched even though Rule 2 fits.
        user_photo = create_test_photo(
            owner=self.user, category_source="user", is_screenshot=False
        )

        job_id = uuid.uuid4()
        classify_media(self.user, job_id)

        for p in screenshots:
            p.refresh_from_db()
            self.assertTrue(p.is_screenshot)

        camera_photo.refresh_from_db()
        self.assertFalse(camera_photo.is_screenshot)

        user_photo.refresh_from_db()
        self.assertFalse(user_photo.is_screenshot)

        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertEqual(job.job_type, LongRunningJob.JOB_CLASSIFY_MEDIA)
        self.assertTrue(job.finished)
        self.assertFalse(job.failed)
        # user_photo is excluded from the queryset -> target counts the other 4.
        self.assertEqual(job.progress_target, 4)
        self.assertEqual(job.progress_current, 4)

    def test_backfill_no_photos_completes(self):
        job_id = uuid.uuid4()
        classify_media(self.user, job_id)
        job = LongRunningJob.objects.get(job_id=str(job_id))
        self.assertTrue(job.finished)
        self.assertEqual(job.progress_target, 0)
