from unittest.mock import patch

from django.test import SimpleTestCase

import api.media_files as file_module


class TestIsVideo(SimpleTestCase):
    def test_is_video_returns_false_when_sniffing_raises(self):
        with patch.object(
            file_module,
            "sniffed_mime_type",
            side_effect=RuntimeError("unreadable"),
        ):
            self.assertFalse(file_module.is_video("/tmp/test.mp4"))
