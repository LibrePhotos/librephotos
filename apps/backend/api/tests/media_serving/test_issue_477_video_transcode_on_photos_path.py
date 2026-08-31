"""Regression test for https://github.com/LibrePhotos/librephotos/issues/477

Reported symptom: opening a video from the "Photos" tab plays the audio but
shows nothing but a black/transparent overlay.  The browser cannot decode the
original container/codec, so it renders no picture.

The only mitigation LibrePhotos ships for this is the per-user setting
"Always transcode videos" (``User.transcode_videos``, exposed in the settings
UI as ``settings.transcodevideo``).  When it is on, the backend is supposed to
pipe the original through ffmpeg and hand the browser a plain H.264/MP4
stream instead of the untouched original file -- the reporter confirmed in the
issue thread that turning it on made the affected videos play again.

The lightbox fetches videos from ``/media/photos/<image_hash>.mp4``
(apps/frontend/src/components/lightbox/MediaDisplay.tsx), whose own comment
states the backend "serves either the original file ... or a transcoded stream
(StreamingHttpResponse) depending on user settings".

But ``UnifiedMediaAccessView.get`` handles ``path == "photos"`` in a separate
tail branch that never consults ``user.transcode_videos`` -- it does not even
load the column (``User.objects.filter(id=...).only("id")``) -- and always
returns the untouched original.  So the setting is a no-op for exactly the
request that plays the video in the lightbox, and the black-video symptom
survives switching it on.

The sibling branch for every other media path *does* honour the setting; the
control test at the bottom of this module demonstrates that, isolating the
defect to the ``photos`` branch.
"""

import io
import os
from unittest.mock import patch

from django.test import TestCase
from rest_framework.test import APIClient
from rest_framework_simplejwt.tokens import AccessToken

from api.tests.utils import create_test_file, create_test_photo, create_test_user

# Minimal well-formed-looking MP4 header so python-magic reports video/mp4.
MP4_BYTES = b"\x00\x00\x00\x18ftypmp42\x00\x00\x00\x00mp42isom" + b"\x00" * 64


class FakeTranscoderProcess:
    """Stand-in for the ffmpeg subprocess spawned by VideoTranscoder."""

    def __init__(self):
        self.stdout = io.BytesIO(b"transcoded-video-bytes\n")
        self.stderr = io.BytesIO(b"")

    def kill(self):
        pass


class FakeVideoTranscoder:
    """Stand-in for api.views.views.VideoTranscoder (no real ffmpeg needed)."""

    def __init__(self, path):
        self.path = path
        self.process = FakeTranscoderProcess()


class AlwaysTranscodeVideosIgnoredInPhotosTabTest(TestCase):
    def setUp(self):
        self.client = APIClient()
        # "Always transcode videos" switched ON in the user's settings.
        self.user = create_test_user(transcode_videos=True)

        os.makedirs("/tmp", exist_ok=True)
        self.photo = create_test_photo(owner=self.user, video=True)
        self.video_path = f"/tmp/{self.photo.image_hash}.mp4"
        self.photo.main_file = create_test_file(self.video_path, self.user, MP4_BYTES)
        self.photo.save()

        # The media view authenticates via the `jwt` cookie, not DRF auth.
        self.client.cookies["jwt"] = str(AccessToken.for_user(self.user))

    def test_photos_tab_video_is_transcoded_when_setting_enabled(self):
        """`/media/photos/<hash>.mp4` must honour "Always transcode videos"."""
        with patch(
            "api.views.views.VideoTranscoder", side_effect=FakeVideoTranscoder
        ) as transcoder:
            response = self.client.get(f"/media/photos/{self.photo.image_hash}.mp4")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(
            transcoder.called,
            "User has transcode_videos=True, but the lightbox video URL "
            "/media/photos/<hash>.mp4 served the original file without ever "
            "invoking VideoTranscoder -- the 'Always transcode videos' setting "
            "is ignored on this code path, so issue #477's only workaround "
            "does nothing.",
        )
        self.assertTrue(
            getattr(response, "streaming", False),
            "Expected a transcoded StreamingHttpResponse for the lightbox "
            "video URL when transcode_videos is enabled.",
        )
        self.assertEqual(response["Content-Type"], "video/mp4")

    def test_control_other_media_paths_do_honour_the_setting(self):
        """Control: the non-`photos` branch already transcodes correctly.

        This passes today and shows the transcoding machinery works; only the
        `path == "photos"` branch used by the lightbox skips it.
        """
        with patch(
            "api.views.views.VideoTranscoder", side_effect=FakeVideoTranscoder
        ) as transcoder:
            response = self.client.get(f"/media/video/{self.photo.image_hash}.mp4")

        self.assertEqual(response.status_code, 200)
        self.assertTrue(transcoder.called)
        self.assertEqual(response["Content-Type"], "video/mp4")
