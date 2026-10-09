"""A grid tile's placeholder colour is read from a still thumbnail.

The colour came from the small square thumbnail, which for a video is an mp4
clip PIL cannot open, so no video ever got one. A rebuilt thumbnail -- Probe
Videos replacing a washed-out HDR one -- kept the colour of the old one.
"""

import os
import shutil
import tempfile
from unittest import mock

from django.test import TestCase, override_settings
from PIL import Image

from api.models import Thumbnail
from api.tests.utils import create_test_photo, create_test_user

RED = (200, 40, 20)
BLUE = (20, 40, 200)


class DominantColorTest(TestCase):
    def setUp(self):
        self.media_root = tempfile.mkdtemp()
        self.addCleanup(shutil.rmtree, self.media_root, ignore_errors=True)
        media = override_settings(MEDIA_ROOT=self.media_root)
        media.enable()
        self.addCleanup(media.disable)
        self.user = create_test_user()

    def _path(self, field_file):
        path = os.path.join(self.media_root, field_file.name)
        os.makedirs(os.path.dirname(path), exist_ok=True)
        return path

    def _still(self, field_file, color):
        Image.new("RGB", (64, 48), color).save(
            self._path(field_file), "WEBP", lossless=True
        )

    @staticmethod
    def _rgb(thumbnail):
        thumbnail.refresh_from_db()
        return tuple(int(c) for c in thumbnail.dominant_color[1:-1].split(", "))

    def test_a_video_gets_the_colour_of_its_big_thumbnail(self):
        thumbnail = create_test_photo(owner=self.user, video=True).thumbnail
        self._still(thumbnail.thumbnail_big, RED)
        # Not a picture: what a video's square thumbnails are to PIL.
        with open(self._path(thumbnail.square_thumbnail_small), "wb") as clip:
            clip.write(b"\x00\x00\x00\x18ftypmp42")

        thumbnail._get_dominant_color()

        self.assertEqual(RED, self._rgb(thumbnail))

    def test_a_photo_still_gets_the_colour_of_its_small_square(self):
        thumbnail = create_test_photo(owner=self.user).thumbnail
        self._still(thumbnail.thumbnail_big, BLUE)
        self._still(thumbnail.square_thumbnail_small, RED)

        thumbnail._get_dominant_color()

        self.assertEqual(RED, self._rgb(thumbnail))

    def _rebuild_with(self, thumbnail, make=None):
        """``_regenerate_thumbnails`` with an ffmpeg whose poster is ``make``'s.

        No ``make``: an ffmpeg that fails.
        """

        def generate(instance):
            if make is None:
                raise RuntimeError("ffmpeg failed")
            make(instance.thumbnail_big)
            instance.save()

        with mock.patch.object(
            Thumbnail, "_generate_thumbnail", autospec=True, side_effect=generate
        ):
            thumbnail._regenerate_thumbnails(keep_old_on_failure=True)

    def test_a_rebuilt_video_samples_its_colour_again(self):
        thumbnail = create_test_photo(
            owner=self.user, video=True, dominant_color=str(list(BLUE))
        ).thumbnail
        self._still(thumbnail.thumbnail_big, BLUE)

        self._rebuild_with(thumbnail, lambda big: self._still(big, RED))

        self.assertEqual(RED, self._rgb(thumbnail))

    def test_a_failed_rebuild_keeps_the_colour_of_the_thumbnail_put_back(self):
        thumbnail = create_test_photo(
            owner=self.user, video=True, dominant_color=str(list(BLUE))
        ).thumbnail
        self._still(thumbnail.thumbnail_big, BLUE)

        with self.assertRaises(RuntimeError):
            self._rebuild_with(thumbnail)

        self.assertEqual(BLUE, self._rgb(thumbnail))

    def test_a_rebuild_that_cannot_be_sampled_clears_the_old_colour(self):
        """The neutral placeholder, not one sampled from another picture."""
        thumbnail = create_test_photo(
            owner=self.user, video=True, dominant_color=str(list(BLUE))
        ).thumbnail
        self._still(thumbnail.thumbnail_big, BLUE)

        def unreadable(big):
            with open(self._path(big), "wb") as poster:
                poster.write(b"not a picture")

        self._rebuild_with(thumbnail, unreadable)

        thumbnail.refresh_from_db()
        self.assertIsNone(thumbnail.dominant_color)
