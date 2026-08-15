"""
Tests for aspect ratio calculation.

A photo whose thumbnail has no ``aspect_ratio`` is filtered out of every grid
view, so it becomes invisible in the UI with no error and no warning. These
tests pin down that the ratio is derived from the thumbnail file we generated
ourselves, rather than from the exif service, so an exif outage during a scan
cannot make photos disappear.
"""

import os
from unittest import mock

from django.conf import settings
from django.test import TestCase
from PIL import Image

from api.directory_watcher.scan_jobs import backfill_missing_aspect_ratios
from api.tests.utils import create_test_photo, create_test_user


def write_big_thumbnail(photo, width, height):
    """Write a real image file at the photo's big-thumbnail path."""
    path = os.path.join(settings.MEDIA_ROOT, photo.thumbnail.thumbnail_big.name)
    os.makedirs(os.path.dirname(path), exist_ok=True)
    Image.new("RGB", (width, height), color="blue").save(path, format="WEBP")
    return path


class CalculateAspectRatioTest(TestCase):
    def setUp(self):
        self.user = create_test_user()

    def tearDown(self):
        for path in getattr(self, "_written", []):
            if os.path.exists(path):
                os.remove(path)

    def _photo_with_thumbnail(self, width, height):
        photo = create_test_photo(owner=self.user, aspect_ratio=None)
        path = write_big_thumbnail(photo, width, height)
        self._written = getattr(self, "_written", []) + [path]
        return photo

    def test_landscape_ratio_read_from_thumbnail(self):
        photo = self._photo_with_thumbnail(300, 200)

        photo.thumbnail._calculate_aspect_ratio()

        photo.thumbnail.refresh_from_db()
        self.assertEqual(photo.thumbnail.aspect_ratio, 1.5)

    def test_portrait_ratio_read_from_thumbnail(self):
        photo = self._photo_with_thumbnail(200, 400)

        photo.thumbnail._calculate_aspect_ratio()

        photo.thumbnail.refresh_from_db()
        self.assertEqual(photo.thumbnail.aspect_ratio, 0.5)

    def test_does_not_call_exif_service(self):
        """The regression: dimensions must not depend on a network service.

        Previously ``get_metadata`` was asked for the dimensions of a thumbnail
        we had just written ourselves, so a degraded exif service left the
        aspect ratio NULL and the photo invisible everywhere. Asserted at the
        HTTP layer so it holds however the reader is imported.
        """
        photo = self._photo_with_thumbnail(400, 200)

        with mock.patch("api.metadata.reader.requests.post") as mock_post:
            photo.thumbnail._calculate_aspect_ratio()

        mock_post.assert_not_called()
        photo.thumbnail.refresh_from_db()
        self.assertEqual(photo.thumbnail.aspect_ratio, 2.0)

    def test_missing_thumbnail_file_does_not_raise(self):
        """A thumbnail path pointing at nothing must not abort the pipeline."""
        photo = create_test_photo(owner=self.user, aspect_ratio=None)

        photo.thumbnail._calculate_aspect_ratio()

        photo.thumbnail.refresh_from_db()
        self.assertIsNone(photo.thumbnail.aspect_ratio)

    def test_empty_thumbnail_field_does_not_raise(self):
        """No thumbnail file at all: warn and return, never raise.

        Accessing ``.path`` on an empty FileField raises ValueError, which the
        old code did inside its own exception handler while logging.
        """
        photo = create_test_photo(owner=self.user, aspect_ratio=None)
        photo.thumbnail.thumbnail_big = ""
        photo.thumbnail.save()

        photo.thumbnail._calculate_aspect_ratio()

        photo.thumbnail.refresh_from_db()
        self.assertIsNone(photo.thumbnail.aspect_ratio)


class BackfillMissingAspectRatiosTest(TestCase):
    def setUp(self):
        self.user = create_test_user()
        self._written = []

    def tearDown(self):
        for path in self._written:
            if os.path.exists(path):
                os.remove(path)

    def test_backfills_photos_with_thumbnails(self):
        photo = create_test_photo(owner=self.user, aspect_ratio=None)
        self._written.append(write_big_thumbnail(photo, 600, 300))

        still_missing = backfill_missing_aspect_ratios(self.user)

        self.assertEqual(still_missing, 0)
        photo.thumbnail.refresh_from_db()
        self.assertEqual(photo.thumbnail.aspect_ratio, 2.0)

    def test_reports_photos_that_could_not_be_repaired(self):
        """The count must reflect the state *after* the repair pass.

        Iterating the queryset caches its rows, so a naive re-``count()`` would
        report the pre-repair number and claim failures that did not happen.
        """
        healthy = create_test_photo(owner=self.user, aspect_ratio=None)
        self._written.append(write_big_thumbnail(healthy, 600, 300))
        # No thumbnail file on disk: cannot be repaired.
        broken = create_test_photo(owner=self.user, aspect_ratio=None)

        still_missing = backfill_missing_aspect_ratios(self.user)

        self.assertEqual(still_missing, 1)
        healthy.thumbnail.refresh_from_db()
        broken.thumbnail.refresh_from_db()
        self.assertEqual(healthy.thumbnail.aspect_ratio, 2.0)
        self.assertIsNone(broken.thumbnail.aspect_ratio)

    def test_no_work_to_do(self):
        create_test_photo(owner=self.user, aspect_ratio=1.5)

        self.assertEqual(backfill_missing_aspect_ratios(self.user), 0)

    def test_leaves_other_users_photos_alone(self):
        other_user = create_test_user()
        other_photo = create_test_photo(owner=other_user, aspect_ratio=None)
        self._written.append(write_big_thumbnail(other_photo, 600, 300))

        self.assertEqual(backfill_missing_aspect_ratios(self.user), 0)

        other_photo.thumbnail.refresh_from_db()
        self.assertIsNone(other_photo.thumbnail.aspect_ratio)
