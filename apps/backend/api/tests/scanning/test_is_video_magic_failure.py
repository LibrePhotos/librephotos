from unittest.mock import patch

from django.test import SimpleTestCase

import api.media_files as file_module


class TestIsVideo(SimpleTestCase):
    def test_is_video_returns_false_when_sniffing_raises(self):
        with patch.object(
            file_module,
            "sniffed_mime_type",
            side_effect=OSError("unreadable"),
        ):
            self.assertFalse(file_module.is_video("/tmp/test.mp4"))


class TestIsValidMedia(SimpleTestCase):
    """An image no loader can open is not media, and says why at INFO."""

    def test_a_decoder_that_cannot_load(self):
        with (
            patch("api.image_decoding.can_decode", side_effect=OSError("libvips")),
            self.assertLogs("api.media_files", "INFO") as logs,
        ):
            self.assertFalse(file_module.is_valid_media("/tmp/test.jpg", None))
        self.assertIn("Could not handle", logs.output[0])
