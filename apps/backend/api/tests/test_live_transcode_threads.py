"""The thread cap on the conversion a viewer is waiting for.

"Always transcode videos" spawns one ffmpeg per request, and ffmpeg takes every
core it can see. Playback only needs the stream to stay ahead of itself, so the
cores beyond that buy a lead nobody perceives while the web UI, the scan and
every other viewer go without. The background conversion in
:mod:`api.transcode_cache` is capped for the same reason; this is the live half.
"""

from unittest import mock

from django.conf import settings
from django.test import TestCase, override_settings

from api.views import views


class LiveTranscodeCommandTest(TestCase):
    def _ffmpeg_command(self):
        with mock.patch("api.views.views.subprocess.Popen") as popen:
            views.VideoTranscoder("/in.mkv")
        return popen.call_args[0][0]

    def test_the_encoder_is_capped_instead_of_taking_every_core(self):
        # The flag has to sit after the input, or it limits decoding rather
        # than encoding, which is where the CPU goes.
        command = self._ffmpeg_command()
        threads = command.index("-threads")
        self.assertGreater(threads, command.index("/in.mkv"))
        self.assertEqual(command[threads + 1], str(settings.TRANSCODE_LIVE_THREADS))

    def test_the_cap_can_be_tuned_to_the_hardware(self):
        with override_settings(TRANSCODE_LIVE_THREADS=3):
            command = self._ffmpeg_command()
        threads = command.index("-threads")
        self.assertEqual(command[threads + 1], "3")
